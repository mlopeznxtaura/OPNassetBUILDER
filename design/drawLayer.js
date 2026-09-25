/** 2D stroke frames for the left animation layer. Keeps the design module graph intact. */
const canvas = document.getElementById('drawCanvas');
if (canvas) {
  const ctx = canvas.getContext('2d');
  const status = document.getElementById('drawStatus');
  const frames = [[]];
  let index = 0;
  let drawing = null;
  let playTimer = 0;

  function fit() {
    const stage = canvas.parentElement;
    if (!stage) return;
    canvas.width = Math.max(200, stage.clientWidth);
    canvas.height = Math.max(180, stage.clientHeight);
    paint(index);
  }

  function paint(upto) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const prev = frames[upto - 1];
    if (prev) strokeList(prev, 'rgba(92,200,255,0.28)', 2);
    strokeList(frames[upto] || [], '#e8e9ec', 2.5);
    if (status) status.textContent = 'Frame ' + (upto + 1) + ' / ' + frames.length + ' · ' + (frames[upto] ? frames[upto].length : 0) + ' strokes';
  }

  function strokeList(list, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of list) {
      if (stroke.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x, stroke[i].y);
      ctx.stroke();
    }
  }

  function point(ev) {
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width;
    const sy = canvas.height / r.height;
    return { x: (ev.clientX - r.left) * sx, y: (ev.clientY - r.top) * sy };
  }

  canvas.addEventListener('pointerdown', (ev) => {
    if (playTimer) return;
    canvas.setPointerCapture(ev.pointerId);
    drawing = [point(ev)];
    frames[index].push(drawing);
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!drawing) return;
    drawing.push(point(ev));
    paint(index);
  });
  canvas.addEventListener('pointerup', () => {
    drawing = null;
    paint(index);
  });

  document.getElementById('btnDrawFrame').onclick = () => {
    frames.push([]);
    index = frames.length - 1;
    paint(index);
  };
  document.getElementById('btnDrawClear').onclick = () => {
    frames.splice(0, frames.length, []);
    index = 0;
    paint(0);
  };
  document.getElementById('btnDrawPlay').onclick = () => {
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = 0;
      paint(index);
      return;
    }
    let i = 0;
    playTimer = setInterval(() => {
      paint(i);
      i += 1;
      if (i >= frames.length) {
        clearInterval(playTimer);
        playTimer = 0;
        index = frames.length - 1;
        paint(index);
      }
    }, 280);
  };

  fit();
  if (window.ResizeObserver) new ResizeObserver(fit).observe(canvas.parentElement);
}
