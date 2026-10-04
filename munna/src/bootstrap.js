// A browser without WebGL must not leave the room stuck on “Connecting”.
try {
  const probe = document.createElement('canvas');
  const context = probe.getContext('webgl2');
  if (!context) throw new Error('WebGL 2 is unavailable');
  context.getExtension('WEBGL_lose_context')?.loseContext();
  await import('./main.js');
} catch (error) {
  document.querySelector('#munnaStateLabel').textContent = '3D unavailable';
  document.querySelector('#roomStatus').textContent = 'This browser cannot start the 3D experience. Modern and Retro use the same shared room.';
  document.querySelector('#feedStatus').textContent = 'Choose Modern or Retro below to keep listening.';
  document.querySelector('#feed').innerHTML = '<p class="empty"><a href="../">Open Modern</a> · <a href="../retro/">Open Retro</a></p>';
  document.querySelector('#reloadMix').disabled = true;
  document.querySelector('#heroPreview').disabled = true;
  console.warn('Munna 3D could not start:', error.message);
}
