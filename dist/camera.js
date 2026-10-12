// All input tools invert the same display-only transform, including mirrored views.
export function canvasPoint(point, camera, width, height) {
  const x = point.x - camera.x,
    y = point.y - camera.y;
  const c = Math.cos(camera.angle),
    s = Math.sin(camera.angle);
  return {
    x: ((x * c + y * s) / camera.scale) * (camera.flipX ? -1 : 1) + width / 2,
    y: ((-x * s + y * c) / camera.scale) * (camera.flipY ? -1 : 1) + height / 2,
  };
}
