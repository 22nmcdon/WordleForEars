// Writing chord symbols the way a chart writes them.
//
// The hand face has no flat or sharp glyph, so accidentals are borrowed from
// the serif at 0.82em - the same trick the branding calls for. Extensions ride
// above the baseline at 0.74em when they follow letters ("maj7", "m7b5"); a
// symbol that is all figures ("7#9", "13") stays at full size, because raising
// the whole thing would leave nothing on the line.

const FLAT = '♭';
const SHARP = '♯';

/** Appends @p text to @p parent, with accidentals in their own serif span. */
function writeWithAccidentals(parent, text) {
  let run = '';

  const flush = () => {
    if (run) parent.appendChild(document.createTextNode(run));
    run = '';
  };

  for (const character of text) {
    if (character === FLAT || character === SHARP || character === 'b' || character === '#') {
      flush();
      const accidental = document.createElement('span');
      accidental.className = 'acc';
      accidental.textContent = character === '#' ? SHARP : character === 'b' ? FLAT : character;
      parent.appendChild(accidental);
    } else {
      run += character;
    }
  }

  flush();
}

/** Engraves a chord quality symbol - "maj7", "m7♭5", "7♯5♯9" - into @p target. */
export function engraveSymbol(target, symbol) {
  target.textContent = '';

  const split = /^([^0-9]+)([0-9].*)$/.exec(symbol);

  if (!split) {
    writeWithAccidentals(target, symbol);
    return target;
  }

  writeWithAccidentals(target, split[1]);

  const extension = document.createElement('span');
  extension.className = 'ext';
  writeWithAccidentals(extension, split[2]);
  target.appendChild(extension);
  return target;
}

/** A note name - "C", "A♯/B♭" - with the second spelling set quieter. */
export function engraveNote(target, label) {
  target.textContent = '';

  const [first, second] = label.split('/');
  writeWithAccidentals(target, first);

  if (second) {
    const alt = document.createElement('span');
    alt.className = 'alt';
    writeWithAccidentals(alt, '/' + second);
    target.appendChild(alt);
  }

  return target;
}

/** The whole chord, root and quality, as one engraved symbol. */
export function engraveChord(target, rootLabel, symbol) {
  target.textContent = '';

  const root = document.createElement('span');
  engraveNote(root, rootLabel);
  target.appendChild(root);

  if (symbol) {
    const quality = document.createElement('span');
    quality.className = 'quality-symbol';
    engraveSymbol(quality, symbol);
    target.appendChild(quality);
  }

  return target;
}
