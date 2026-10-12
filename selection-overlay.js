// Rebuild mask geometry only when the selection changes, not on every canvas paint.
export function createSelectionOverlay() {
  const surface = document.createElement('canvas');
  const tile = document.createElement('canvas');
  tile.width = tile.height = 8;
  const ink = tile.getContext('2d');
  ink.strokeStyle = '#ffffff40';
  ink.lineWidth = 1;
  for (let x = -8; x <= 8; x += 8) {
    ink.beginPath();
    ink.moveTo(x, 0);
    ink.lineTo(x + 8, 8);
    ink.stroke();
  }
  let previous, edge, outside, pattern;
  function prepare(mask, w, h, force) {
    if (!force && previous === mask && surface.width === w && surface.height === h) return;
    previous = mask;
    surface.width = w;
    surface.height = h;
    const image = new ImageData(w, h);
    edge = new Path2D();
    outside = new Path2D();
    for (let y = 0; y < h; y++) {
      let run = -1;
      for (let x = 0; x <= w; x++) {
        const i = y * w + x,
          selected = x < w && !!mask[i];
        if (x < w && !selected && run < 0) run = x;
        if ((selected || x === w) && run >= 0) {
          outside.rect(run, y, x - run, 1);
          run = -1;
        }
        if (!selected) continue;
        image.data.fill(255, i * 4, i * 4 + 4);
        if (!y || !mask[i - w]) {
          edge.moveTo(x, y);
          edge.lineTo(x + 1, y);
        }
        if (y === h - 1 || !mask[i + w]) {
          edge.moveTo(x, y + 1);
          edge.lineTo(x + 1, y + 1);
        }
        if (!x || !mask[i - 1]) {
          edge.moveTo(x, y);
          edge.lineTo(x, y + 1);
        }
        if (x === w - 1 || !mask[i + 1]) {
          edge.moveTo(x + 1, y);
          edge.lineTo(x + 1, y + 1);
        }
      }
    }
    surface.getContext('2d').putImageData(image, 0, 0);
  }
  return {
    draw(ctx, mask, w, h, scale, editing, opacity = 0.45, force = false) {
      if (!mask) {
        previous = null;
        return;
      }
      prepare(mask, w, h, force);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      if (editing) {
        ctx.globalCompositeOperation = 'difference';
        ctx.drawImage(surface, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.save();
        ctx.clip(outside);
        ctx.globalAlpha = opacity;
        ctx.fillStyle = '#15171c';
        ctx.fillRect(0, 0, w, h);
        pattern ||= ctx.createPattern(tile, 'repeat');
        pattern.setTransform(new DOMMatrix().scale(1 / scale));
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
      ctx.lineWidth = 1 / scale;
      ctx.strokeStyle = '#122034';
      ctx.stroke(edge);
      ctx.strokeStyle = '#e4f4ff';
      ctx.setLineDash([4 / scale, 3 / scale]);
      ctx.stroke(edge);
      ctx.restore();
    },
  };
}
