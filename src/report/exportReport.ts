import { layoutCfg } from '../cfg/layout';
import type { McdcMode } from '../engine';
import componentsCss from '../styles/components.css?raw';
import tokensCss from '../styles/tokens.css?raw';
import { renderCfgSvg } from '../ui/cfgSvg';
import { renderConditionGraph } from '../ui/ConditionGraphView';
import { buildReport } from './buildReport';
import reportCss from './report.css?raw';
import runtimeJs from './runtime.js?raw';
import { decisionKey, fileKey, type ReportFile } from './types';

export interface ReportRequest {
  readonly files: readonly ReportFile[];
  readonly mode: McdcMode;
  readonly projectName?: string;
}

/** Renders the analysis to a standalone HTML document (browser only: uses the DOM for SVG). */
export async function renderReport(
  request: ReportRequest,
  generatedAt: Date,
  onProgress?: (done: number, total: number) => void,
): Promise<string> {
  const multiFile = request.files.length > 1;
  const cfgSvgs = new Map<string, string>();
  const conditionGraphSvgs = new Map<string, string>();

  for (const [index, file] of request.files.entries()) {
    const key = fileKey(index);
    const { program, decisions } = file.analysis;
    // Multi-file reports only show files and functions that contain decisions.
    if (multiFile && program.decisions.length === 0) continue;
    for (const fn of program.functions) {
      if (multiFile && !program.decisions.some((d) => d.functionId === fn.id)) continue;
      const layout = await layoutCfg(fn.cfg);
      cfgSvgs.set(`${key}-${fn.id}`, renderCfgSvg(layout, fn, { idPrefix: `report-${key}-${fn.id}` }).outerHTML);
    }
    for (const decision of program.decisions) {
      const result = decisions.get(decision.id);
      if (!result) continue;
      const dKey = decisionKey(key, decision.id);
      const svg = renderConditionGraph({ decision, result, row: null, conditionIndex: null, idPrefix: `report-${dKey}` });
      conditionGraphSvgs.set(dKey, svg.outerHTML);
    }
    onProgress?.(index + 1, request.files.length);
  }

  return buildReport({
    files: request.files,
    mode: request.mode,
    ...(request.projectName !== undefined ? { projectName: request.projectName } : {}),
    generatedAt,
    cfgSvgs,
    conditionGraphSvgs,
    assets: { styles: [tokensCss, componentsCss, reportCss].join('\n'), script: runtimeJs },
  });
}

/** Builds the report and downloads it as an .html file. */
export async function exportReport(
  request: ReportRequest,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const generatedAt = new Date();
  const html = await renderReport(request, generatedAt, onProgress);
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = reportFileName(request, generatedAt);
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke after the click has been handled so the download can start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function reportFileName(request: ReportRequest, date: Date): string {
  const named = request.files
    .flatMap((file) => file.analysis.program.functions)
    .find((fn) => fn.name !== '(top level)' && !fn.name.startsWith('anonymous'));
  const base = request.projectName ?? named?.name ?? 'snippet';
  const slug = base.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'snippet';
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `mcdc-report-${slug}-${stamp}.html`;
}
