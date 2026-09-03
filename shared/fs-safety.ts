import fs from "node:fs";

/**
 * Refuse paths writable by group/others, or not owned by this uid (unix).
 * Windows has no posix uid/mode model comparable to 022; caller uses HKCU.
 */
export function assertOwnedAndNotWorldWritable(p: string, uid = process.getuid?.()): void {
  if (process.platform === "win32") return;
  let st: fs.Stats;
  try {
    st = fs.lstatSync(p);
  } catch (err) {
    throw new Error(`cannot stat ${p}: ${(err as Error).message}`);
  }
  if (st.isSymbolicLink()) {
    throw new Error(`${p} is a symlink; refuse to use it`);
  }
  if (uid != null && st.uid !== uid) {
    throw new Error(`${p} is not owned by the current user (uid ${st.uid} != ${uid})`);
  }
  if (st.mode & 0o022) {
    throw new Error(
      `${p} is writable by group or others (mode ${(st.mode & 0o777).toString(8)})`,
    );
  }
}

export function chmodPrivateDir(dir: string): void {
  fs.chmodSync(dir, 0o700);
  if (process.platform === "win32") return;
  const st = fs.statSync(dir);
  if (st.mode & 0o077) {
    throw new Error(`config dir ${dir} is still group/other-accessible after chmod`);
  }
}

export function chmodPrivateFile(file: string): void {
  fs.chmodSync(file, 0o600);
  if (process.platform === "win32") return;
  const st = fs.statSync(file);
  if (st.mode & 0o077) {
    throw new Error(`file ${file} is still group/other-accessible after chmod`);
  }
}
