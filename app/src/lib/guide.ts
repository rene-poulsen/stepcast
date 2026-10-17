// Step-by-step guide (HTML + Markdown) built from the same steps as the video.
import type { Step } from './steps';
import type { Lang, Project } from './types';

export interface GuideStep {
  text: string;
  image: string;
  /** Highlight in percent of the image, if the element's position is known. */
  box: { left: number; top: number; width: number; height: number } | null;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function guideSteps(project: Project, steps: Step[], images: string[]): GuideStep[] {
  if (!project.screen) return [];
  const { x, y, monitorWidth: width, monitorHeight: height } = project.screen;
  return steps.map((step, i) => {
    const r = step.event.action === 'navigate' ? undefined : step.event.rect;
    const pad = 4;
    return {
      text: step.text,
      image: images[i],
      box: r
        ? {
            left: ((r.x - x - pad) / width) * 100,
            top: ((r.y - y - pad) / height) * 100,
            width: ((r.w + pad * 2) / width) * 100,
            height: ((r.h + pad * 2) / height) * 100,
          }
        : null,
    };
  });
}

export function guideHtml(title: string, steps: GuideStep[], lang: Lang): string {
  const pct = (n: number) => `${n.toFixed(2)}%`;
  const items = steps
    .map(
      (s, i) => `    <li>
      <p><span class="n">${i + 1}</span>${escapeHtml(s.text)}</p>
      <figure>
        <img src="img/${s.image}" alt="${escapeHtml(s.text)}" loading="lazy" />${
          s.box
            ? `\n        <span class="hl" style="left:${pct(s.box.left)};top:${pct(s.box.top)};width:${pct(s.box.width)};height:${pct(s.box.height)}"></span>`
            : ''
        }
      </figure>
    </li>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { --bg: #fff; --text: #37352f; --muted: #787774; --border: #e9e9e7; --accent: #2383e2; }
    @media (prefers-color-scheme: dark) { :root { --bg: #191919; --text: #e3e2e0; --muted: #9b9a97; --border: #2f2f2f; } }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; }
    main { max-width: 900px; margin: 0 auto; padding: 56px 16px 80px; }
    h1 { font-size: 32px; line-height: 1.2; margin: 0 0 32px; letter-spacing: -0.01em; }
    ol { list-style: none; margin: 0; padding: 0; }
    li { margin: 0 0 40px; }
    li p { display: flex; align-items: center; gap: 12px; margin: 0 0 12px; font-weight: 600; font-size: 18px; }
    .n { flex: none; display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--text); color: var(--bg); font-size: 14px; }
    figure { position: relative; margin: 0; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
    img { display: block; width: 100%; height: auto; }
    .hl { position: absolute; border: 3px solid var(--accent); border-radius: 6px; box-shadow: 0 0 0 9999px rgba(0,0,0,.12); }
    footer { color: var(--muted); font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <ol>
${items}
    </ol>
    <footer>Made with Stepcast</footer>
  </main>
</body>
</html>
`;
}

export function guideMarkdown(title: string, steps: GuideStep[]): string {
  const body = steps.map((s, i) => `## ${i + 1}. ${s.text}\n\n![${s.text}](img/${s.image})\n`).join('\n');
  return `# ${title}\n\n${body}`;
}
