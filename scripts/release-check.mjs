export function assertRelease(version, commit, build) {
  if (version?.commit !== commit || version?.build !== build || version?.version !== '1.1.' + build) throw new Error('Deployed release does not match the tested commit and build');
}
