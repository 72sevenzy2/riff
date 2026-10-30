'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { cleanSearchResults } = require('../src/server/server');

test('removes irrelevant tracks and keeps matching results in relevance order', () => {
  const tracks = [
    { id: 'unrelated', title: 'Different Song', artist: 'Other Artist', platform: 'soundcloud' },
    { id: 'matching', title: 'One Way Ticket', artist: 'ONDA ANDAR', platform: 'soundcloud' },
    { id: 'partial', title: 'Ticket', artist: 'Onda Andar', platform: 'soundcloud' },
    { id: 'weak-match', title: 'Maple (Slowed)', artist: 'Other Artist', platform: 'soundcloud' }
  ];

  assert.deepStrictEqual(
    cleanSearchResults(tracks, 'one way ticket ONDA ANDAR').map(track => track.id),
    ['matching', 'partial']
  );
});

test('removes duplicate releases without changing the displayed title', () => {
  const tracks = [
    { id: 'first', title: 'Maple (Official Audio)', artist: 'Chainsaww', platform: 'soundcloud' },
    { id: 'second', title: 'Maple', artist: 'Chainsaww', platform: 'soundcloud' }
  ];

  const result = cleanSearchResults(tracks, 'chainsaww Maple');
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].title, 'Maple (Official Audio)');
});

test('requires a meaningful match for multiword artist and title searches', () => {
  const tracks = [
    { id: 'matching', title: 'Chainsaww (feat. Siouxxie)', artist: 'Maple', platform: 'soundcloud' },
    { id: 'weak-match', title: 'Maple (Slowed)', artist: 'Other Artist', platform: 'soundcloud' }
  ];

  assert.deepStrictEqual(
    cleanSearchResults(tracks, 'chainsaww Maple').map(track => track.id),
    ['matching']
  );
});

test('removes hour-long and audio compilation results', () => {
  const tracks = [
    { id: 'song', title: 'Masquerade', artist: 'Sioxxie', platform: 'soundcloud' },
    { id: 'long', title: 'SCP-3008 Friday Theme 1 hour', artist: 'Sioxxie', platform: 'soundcloud' },
    { id: 'mix', title: 'Nightcore TikTok Audios May Part 4', artist: 'Sioxxie', platform: 'soundcloud' }
  ];

  assert.deepStrictEqual(
    cleanSearchResults(tracks, 'Sioxxie').map(track => track.id),
    ['song']
  );
});
