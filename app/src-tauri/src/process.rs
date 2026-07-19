use std::{
    fmt,
    io::{self, Read},
    process::{Child, Command, Output, Stdio},
    thread,
    time::{Duration, Instant},
};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

#[cfg(unix)]
extern "C" {
    fn kill(pid: i32, signal: i32) -> i32;
}

#[cfg(unix)]
const SIGTERM: i32 = 15;
#[cfg(unix)]
const SIGKILL: i32 = 9;

const MAX_CAPTURED_STREAM_BYTES: usize = 64 * 1024;

#[derive(Debug)]
pub struct BoundedOutput {
    pub output: Output,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
}

#[derive(Debug)]
struct CapturedStream {
    bytes: Vec<u8>,
    truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProcessError {
    Io(String),
    TimedOut,
}

impl fmt::Display for ProcessError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(message) => formatter.write_str(message),
            Self::TimedOut => formatter.write_str("子进程超过执行时限，已停止"),
        }
    }
}

pub fn run_with_timeout(command: &mut Command, timeout: Duration) -> Result<Output, ProcessError> {
    run_with_timeout_limit(command, timeout, MAX_CAPTURED_STREAM_BYTES).map(|result| result.output)
}

pub fn run_with_timeout_limit(
    command: &mut Command,
    timeout: Duration,
    stream_limit: usize,
) -> Result<BoundedOutput, ProcessError> {
    #[cfg(unix)]
    command.process_group(0);

    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| ProcessError::Io(error.to_string()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ProcessError::Io("无法捕获子进程标准输出".to_string()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| ProcessError::Io("无法捕获子进程错误输出".to_string()))?;
    let stdout_reader = thread::spawn(move || drain_bounded(stdout, stream_limit));
    let stderr_reader = thread::spawn(move || drain_bounded(stderr, stream_limit));

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
            Ok(None) => {
                terminate_child_tree(&mut child);
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(ProcessError::TimedOut);
            }
            Err(error) => {
                terminate_child_tree(&mut child);
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(ProcessError::Io(error.to_string()));
            }
        }
    };
    let pipe_deadline = Instant::now() + Duration::from_millis(150);
    while (!stdout_reader.is_finished() || !stderr_reader.is_finished())
        && Instant::now() < pipe_deadline
    {
        thread::sleep(Duration::from_millis(10));
    }
    if !stdout_reader.is_finished() || !stderr_reader.is_finished() {
        terminate_child_tree(&mut child);
    }
    let stdout = stdout_reader
        .join()
        .map_err(|_| ProcessError::Io("读取子进程标准输出时线程异常".to_string()))?
        .map_err(|error| ProcessError::Io(error.to_string()))?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| ProcessError::Io("读取子进程错误输出时线程异常".to_string()))?
        .map_err(|error| ProcessError::Io(error.to_string()))?;
    Ok(BoundedOutput {
        stdout_truncated: stdout.truncated,
        stderr_truncated: stderr.truncated,
        output: Output {
            status,
            stdout: stdout.bytes,
            stderr: stderr.bytes,
        },
    })
}

fn drain_bounded(mut reader: impl Read, limit: usize) -> io::Result<CapturedStream> {
    let mut captured = Vec::with_capacity(limit.min(8192));
    let mut truncated = false;
    let mut chunk = [0_u8; 8192];
    loop {
        let count = reader.read(&mut chunk)?;
        if count == 0 {
            return Ok(CapturedStream {
                bytes: captured,
                truncated,
            });
        }
        if captured.len() < limit {
            let retained = (limit - captured.len()).min(count);
            captured.extend_from_slice(&chunk[..retained]);
            truncated |= retained < count;
        } else {
            truncated = true;
        }
    }
}

fn terminate_child_tree(child: &mut Child) {
    #[cfg(unix)]
    {
        let process_group = -(child.id() as i32);
        // SAFETY: the child was placed in a dedicated process group immediately
        // before spawn, and signals carry no borrowed memory across the FFI boundary.
        unsafe {
            let _ = kill(process_group, SIGTERM);
        }
        let grace_deadline = Instant::now() + Duration::from_millis(150);
        while Instant::now() < grace_deadline {
            if matches!(child.try_wait(), Ok(Some(_))) {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        // SAFETY: as above; SIGKILL guarantees descendants cannot retain the
        // captured stdout/stderr pipes after the operation deadline.
        unsafe {
            let _ = kill(process_group, SIGKILL);
        }
        let _ = child.wait();
        return;
    }

    #[cfg(not(unix))]
    {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg(test)]
mod tests {
    use std::{
        process::Command,
        time::{Duration, Instant},
    };

    use super::*;

    #[test]
    fn child_processes_are_stopped_at_the_declared_deadline() {
        let mut command = Command::new("/bin/sleep");
        command.arg("2");

        let error = run_with_timeout(&mut command, Duration::from_millis(50)).unwrap_err();

        assert!(matches!(error, ProcessError::TimedOut));
    }

    #[test]
    fn timeout_stops_descendants_that_keep_output_pipes_open() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "(trap '' TERM; sleep 2) & wait"]);
        let started = Instant::now();

        let error = run_with_timeout(&mut command, Duration::from_millis(50)).unwrap_err();

        assert!(matches!(error, ProcessError::TimedOut));
        assert!(
            started.elapsed() < Duration::from_millis(750),
            "timed-out descendant kept the captured output pipe open"
        );
    }

    #[test]
    fn successful_parent_cannot_leave_a_pipe_holding_descendant() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "(trap '' TERM; sleep 2) & exit 0"]);
        let started = Instant::now();

        let output = run_with_timeout(&mut command, Duration::from_secs(1)).unwrap();

        assert!(output.status.success());
        assert!(
            started.elapsed() < Duration::from_millis(750),
            "successful parent left a descendant holding the captured output pipe"
        );
    }

    #[test]
    fn timeout_does_not_signal_an_unrelated_process() {
        let mut sentinel = Command::new("/bin/sleep").arg("2").spawn().unwrap();
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "(trap '' TERM; sleep 2) & wait"]);

        let error = run_with_timeout(&mut command, Duration::from_millis(50)).unwrap_err();

        assert!(matches!(error, ProcessError::TimedOut));
        assert!(sentinel.try_wait().unwrap().is_none());
        let _ = sentinel.kill();
        let _ = sentinel.wait();
    }

    #[test]
    fn successful_process_output_is_drained_but_bounded_in_memory() {
        let mut command = Command::new("/bin/sh");
        command.args([
            "-c",
            "head -c 200000 /dev/zero; head -c 200000 /dev/zero >&2",
        ]);

        let output = run_with_timeout(&mut command, Duration::from_secs(2)).unwrap();

        assert!(output.status.success());
        assert_eq!(output.stdout.len(), MAX_CAPTURED_STREAM_BYTES);
        assert_eq!(output.stderr.len(), MAX_CAPTURED_STREAM_BYTES);
    }

    #[test]
    fn larger_integrity_sensitive_capture_reports_truncation() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "head -c 200000 /dev/zero"]);

        let result =
            run_with_timeout_limit(&mut command, Duration::from_secs(2), 128 * 1024).unwrap();

        assert!(result.output.status.success());
        assert_eq!(result.output.stdout.len(), 128 * 1024);
        assert!(result.stdout_truncated);
        assert!(!result.stderr_truncated);
    }
}
