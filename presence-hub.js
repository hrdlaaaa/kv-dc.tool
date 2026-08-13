(() => {
  'use strict';

  const presenceVariant = document.getElementById('presenceVariant');
  const presenceFrame = document.getElementById('presenceFrame');
  const presencePlaceholder = document.getElementById('presencePlaceholder');

  const PRESENCE_SOURCES = {
    prijem: './presence-prijem.html?embedded=1',
    vydej: './presence-vydej.html?embedded=1',
    kabely: './presence-kabely.html?embedded=1'
  };

  presenceVariant.addEventListener('change', () => {
    const src = PRESENCE_SOURCES[presenceVariant.value];
    if (!src) {
      presenceFrame.hidden = true;
      presenceFrame.removeAttribute('src');
      presencePlaceholder.hidden = false;
      return;
    }
    presencePlaceholder.hidden = true;
    presenceFrame.hidden = false;
    if (presenceFrame.getAttribute('src') !== src) presenceFrame.setAttribute('src', src);
  });
})();
