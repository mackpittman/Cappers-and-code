// Legacy address. Game pages now live under the Games tab at /games/<id>, so the bottom bar stays
// on screen; shared links, bookmarks and the 404 bounce that still say /game/<id> land here and
// are sent on.
import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function LegacyGameRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <Redirect href={{ pathname: '/games/[id]', params: { id: String(id ?? '') } }} withAnchor />
  );
}
