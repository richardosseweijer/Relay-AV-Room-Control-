/** Shared session/store module for control server fns (MR1 / MR2). */
export async function loadControl() {
  return import("./session.server");
}
