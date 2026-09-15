/** Canvas paths stay sharp in JPEG exports and do not depend on emoji fonts. */
export function drawEventIcon(ctx, type, x, y, size, color) {
  ctx.save()
  ctx.translate(x, y)
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = Math.max(2, size * 0.075)
  ctx.lineCap = 'round'
  if (type === 'try') {
    ctx.rotate(-Math.PI / 5)
    ctx.beginPath()
    ctx.ellipse(0, 0, size * 0.47, size * 0.29, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(-size * 0.23, 0)
    ctx.lineTo(size * 0.23, 0)
    for (const at of [-0.12, 0, 0.12]) {
      ctx.moveTo(size * at, -size * 0.09)
      ctx.lineTo(size * at, size * 0.09)
    }
    ctx.stroke()
  } else if (type === 'kick') {
    ctx.beginPath()
    ctx.moveTo(-size * 0.3, -size * 0.45)
    ctx.lineTo(-size * 0.3, size * 0.45)
    ctx.moveTo(size * 0.3, -size * 0.45)
    ctx.lineTo(size * 0.3, size * 0.45)
    ctx.moveTo(-size * 0.3, size * 0.08)
    ctx.lineTo(size * 0.3, size * 0.08)
    ctx.stroke()
  } else {
    ctx.rotate(-Math.PI / 12)
    ctx.fillRect(-size * 0.27, -size * 0.4, size * 0.54, size * 0.8)
  }
  ctx.restore()
}
