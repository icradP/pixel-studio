// Resource budgets are independent of canvas aspect ratio and layer count.
// A decoded plane plus editing/compositing copies must fit the working budget.
export const PLANE_BYTES = 64 * 1024 * 1024;
export const PROJECT_BYTES = 256 * 1024 * 1024;
export function canvasPixels(w, h) {
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1)
    throw Error('画布宽高必须为正整数');
  const area = w * h;
  if (!Number.isSafeInteger(area) || area * 4 > PLANE_BYTES)
    throw Error(
      `单张像素面需要 ${((area * 4) / 1048576).toFixed(1)} MiB，超过 ${PLANE_BYTES / 1048576} MiB 编辑缓冲预算，请降低画布面积`,
    );
  return area;
}
