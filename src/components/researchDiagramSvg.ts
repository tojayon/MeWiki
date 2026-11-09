const unsafeCss = (value: string) => /@import|(?:https?|data|javascript|file):|expression\s*\(/i.test(value) || [...value.matchAll(/url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)].some(match => !(match[1] ?? match[2] ?? match[3] ?? "").trim().startsWith("#"));

/** Mermaid's strict mode is the first boundary; retain only self-contained SVG output. */
export function sanitizeDiagramSvg(source: string): string {
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  if (root.localName !== "svg" || document.querySelector("parsererror")) throw new Error("图形生成失败，请检查源码后重试。");
  for (const element of [...root.querySelectorAll("script,foreignObject,image,iframe,object,embed,audio,video,link,animate,set,animateMotion,animateTransform")]) element.remove();
  for (const element of [root, ...root.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      const key = attribute.localName.toLowerCase(), value = attribute.value;
      if (key.startsWith("on") || key === "href" || key === "src" || key === "formaction" || key === "srcset" || unsafeCss(value)) element.removeAttributeNode(attribute);
    }
    if (element.localName === "style" && unsafeCss(element.textContent ?? "")) element.remove();
  }
  root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  root.setAttribute("role", "img");
  return new XMLSerializer().serializeToString(root);
}

/** Measure the mounted, sanitized graphic in its own coordinates, not the temporary render tree. */
export function fitDiagramSvgViewport(svg: SVGSVGElement): void {
  const box = svg.getBBox();
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) return;
  const padding = 8, width = box.width + padding * 2, height = box.height + padding * 2;
  svg.setAttribute("viewBox", `${box.x - padding} ${box.y - padding} ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.maxWidth = `${width}px`;
}
