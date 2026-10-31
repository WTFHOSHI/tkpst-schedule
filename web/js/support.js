import { version } from './version.js';
const safe = value => typeof value === 'string' || typeof value === 'number' ? String(value).replace(/[^a-zA-Z0-9 ._+()/-]/g, '').slice(0, 80) : '';
export function diagnosticInfo(native, userAgent = '') {
  const agent = String(userAgent).slice(0, 1000);
  const android = /Android ([0-9.]+)/.exec(agent), ios = /(?:iPhone OS|CPU OS) ([0-9_]+)/.exec(agent);
  const chrome = /Chrome\/([0-9.]+)/.exec(agent), webkit = /AppleWebKit\/([0-9.]+)/.exec(agent);
  const platform = ['Android', 'iOS'].includes(native?.platform) ? native.platform : android ? 'Android' : ios ? 'iOS' : 'Browser';
  return {
    appVersion: safe(native?.appVersion) || 'Web', appBuild: safe(native?.build) || '-',
    webVersion: version.version, commit: version.commit,
    system: platform + ' ' + (safe(native?.osVersion) || android?.[1] || ios?.[1].replaceAll('_', '.') || ''),
    engine: safe(native?.engine) || (chrome ? 'Chromium ' + chrome[1] : webkit ? (platform === 'iOS' ? 'WKWebView / WebKit ' : 'WebKit ') + webkit[1] : 'Unknown'),
  };
}
export function currentDiagnostics() {
  let native = globalThis.__tkpstNativeInfo;
  try { if (globalThis.TkpstTheme?.getAppInfo) native = JSON.parse(globalThis.TkpstTheme.getAppInfo()); } catch {}
  return diagnosticInfo(native, globalThis.navigator?.userAgent);
}
export function reportText(info) {
  return ['Сообщение об ошибке ТКПСТ', '', 'Что произошло:', '', 'Как повторить:', '', 'Технические данные:',
    'Приложение: ' + info.appVersion + ' (' + info.appBuild + ')', 'Интерфейс: ' + info.webVersion,
    'Версия кода: ' + info.commit, 'Система: ' + info.system, 'Движок: ' + info.engine].join('\n');
}
