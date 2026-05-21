// electron-builder afterAllArtifactBuild hook:
// Sign the .dmg, notarize it, and staple the ticket.
// electron-builder already notarizes + staples the .app inside the dmg, but
// the .dmg file itself needs a separate round so Gatekeeper accepts the
// downloaded .dmg offline.
//
// Skipped when notarization env vars are missing, so dev iteration still works.

const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

function sh(cmd, args, { allowFail = false } = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  if (res.status !== 0 && !allowFail) {
    throw new Error(`${cmd} ${args.join(' ')} failed (exit ${res.status})`);
  }
  return res.status === 0;
}

exports.default = async function afterAllArtifactBuild(buildResult) {
  if (process.platform !== 'darwin') return [];

  const required = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.log(`[dmg] notarize skipped (missing ${missing.join(', ')})`);
    return [];
  }

  // Identity resolution order:
  //   1. APPLE_SIGNING_IDENTITY  (full string, e.g. "Developer ID Application: Foo Bar (TEAMID)")
  //   2. Look up the first "Developer ID Application: ... (APPLE_TEAM_ID)" cert in the keychain
  let signingIdentity = process.env.APPLE_SIGNING_IDENTITY || '';
  const teamId = process.env.APPLE_TEAM_ID;
  if (!signingIdentity && teamId) {
    const list = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
    const match = (list.stdout || '').split('\n')
      .map((line) => line.match(/"(Developer ID Application:[^"]*\(([^)]+)\))"/))
      .filter((m) => m && m[2] === teamId)
      .map((m) => m[1])[0];
    if (match) signingIdentity = match;
  }
  if (!signingIdentity) {
    console.log('[dmg] notarize skipped (no APPLE_SIGNING_IDENTITY and no matching Developer ID Application cert for APPLE_TEAM_ID)');
    return [];
  }

  const dmgs = (buildResult.artifactPaths || []).filter((p) => p.endsWith('.dmg'));
  if (dmgs.length === 0) {
    console.log('[dmg] no dmg artifacts found');
    return [];
  }

  const keyPath = path.resolve(process.env.APPLE_API_KEY);
  if (!fs.existsSync(keyPath)) throw new Error(`APPLE_API_KEY not found: ${keyPath}`);

  for (const dmg of dmgs) {
    console.log(`[dmg] signing ${path.basename(dmg)}`);
    sh('codesign', ['--force', '--sign', signingIdentity, '--timestamp', dmg]);

    console.log(`[dmg] submitting to notarytool (will block until Apple responds)`);
    sh('xcrun', [
      'notarytool', 'submit', dmg,
      '--key', keyPath,
      '--key-id', process.env.APPLE_API_KEY_ID,
      '--issuer', process.env.APPLE_API_ISSUER,
      '--wait',
    ]);

    console.log(`[dmg] stapling ticket`);
    sh('xcrun', ['stapler', 'staple', dmg]);
    sh('xcrun', ['stapler', 'validate', dmg]);
    console.log(`[dmg] ✓ ${path.basename(dmg)} signed + notarized + stapled`);
  }
  return [];
};
