/** Check for a usable adapter, rather than just the presence of the WebGPU API. */
export async function supportsWebGpu(): Promise<boolean> {
  if (!globalThis.isSecureContext) return false;
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try { return !!await gpu.requestAdapter(); } catch { return false; }
}
