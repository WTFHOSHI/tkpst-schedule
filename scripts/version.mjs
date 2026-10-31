export function releaseVersion(commit = 'development', build = 'local') {
  if (!/^(?:[0-9a-f]{7,40}|development)$/.test(commit) || !/^(?:[0-9]{1,10}|local)$/.test(build)) throw new Error('Invalid release metadata');
  return { version: build === 'local' ? '1.1.0-dev' : '1.1.' + build, commit, build };
}
