() => {
  const number = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const compact = (value) => {
    const rounded = Math.round(value * 1000) / 1000;
    return String(Object.is(rounded, -0) ? 0 : rounded);
  };
  const byte = (value) => Math.max(0, Math.min(255, Math.round(value)));
  const hex = (red, green, blue) => `#${[red, green, blue]
    .map((value) => byte(value).toString(16).padStart(2, "0")).join("")}`;
  const hslToRgb = (hue, saturation, lightness) => {
    const h = ((hue % 360) + 360) % 360;
    const s = saturation / 100;
    const l = lightness / 100;
    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const segment = h / 60;
    const secondary = chroma * (1 - Math.abs((segment % 2) - 1));
    const [red, green, blue] = segment < 1 ? [chroma, secondary, 0]
      : segment < 2 ? [secondary, chroma, 0]
        : segment < 3 ? [0, chroma, secondary]
          : segment < 4 ? [0, secondary, chroma]
            : segment < 5 ? [secondary, 0, chroma] : [chroma, 0, secondary];
    const offset = l - chroma / 2;
    return [red + offset, green + offset, blue + offset].map((channel) => channel * 255);
  };

  const normalize = (raw) => {
    if (typeof raw !== "string" || raw.length > 96) return null;
    const value = raw.trim();
    const hexadecimal = value.match(/^#([0-9a-f]{6})$/i);
    if (hexadecimal) {
      const normalized = `#${hexadecimal[1].toLowerCase()}`;
      return { value: normalized, picker: normalized };
    }
    if (/^transparent$/i.test(value)) return { value: "transparent", picker: "#000000" };

    const rgb = value.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i);
    if (rgb) {
      const channels = rgb.slice(1, 4).map(number);
      const alpha = rgb[4] === undefined ? null : number(rgb[4]);
      if (channels.some((channel) => channel === null || channel < 0 || channel > 255) ||
          (alpha !== null && (alpha < 0 || alpha > 1))) return null;
      const rounded = channels.map(byte);
      const functionName = alpha === null ? "rgb" : "rgba";
      const serialized = alpha === null ? rounded.join(", ") : `${rounded.join(", ")}, ${compact(alpha)}`;
      return { value: `${functionName}(${serialized})`, picker: hex(...rounded) };
    }

    const hsl = value.match(/^hsla?\(\s*([0-9.]+)(?:deg)?\s*,\s*([0-9.]+)%\s*,\s*([0-9.]+)%(?:\s*,\s*([0-9.]+))?\s*\)$/i);
    if (hsl) {
      const hue = number(hsl[1]);
      const saturation = number(hsl[2]);
      const lightness = number(hsl[3]);
      const alpha = hsl[4] === undefined ? null : number(hsl[4]);
      if (hue === null || saturation === null || lightness === null || saturation < 0 || saturation > 100 ||
          lightness < 0 || lightness > 100 || (alpha !== null && (alpha < 0 || alpha > 1))) return null;
      const normalizedHue = ((hue % 360) + 360) % 360;
      const functionName = alpha === null ? "hsl" : "hsla";
      const serialized = alpha === null
        ? `${compact(normalizedHue)}, ${compact(saturation)}%, ${compact(lightness)}%`
        : `${compact(normalizedHue)}, ${compact(saturation)}%, ${compact(lightness)}%, ${compact(alpha)}`;
      return { value: `${functionName}(${serialized})`, picker: hex(...hslToRgb(normalizedHue, saturation, lightness)) };
    }
    return null;
  };

  return { normalize };
}
