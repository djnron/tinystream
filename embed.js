// Music Box embed helper. Add it after a Music Box <iframe> on your page and the frame's height
// follows the player (skins come in different heights). Without it the frame keeps the height
// in the embed code. It only listens for size messages from Music Box.
(function () {
  var origin = new URL(document.currentScript ? document.currentScript.src : location.href).origin;
  window.addEventListener('message', function (e) {
    if (e.origin !== origin || !e.data || e.data.type !== 'musicbox:size') return;
    var frames = document.getElementsByTagName('iframe');
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === e.source) {
        frames[i].style.height = Math.min(2000, Math.max(120, Number(e.data.height) || 0)) + 'px';
      }
    }
  });
})();
