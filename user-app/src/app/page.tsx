"use client";

import dynamic from 'next/dynamic';
import React from 'react';

// Dynamically import the map to avoid SSR issues with Leaflet
const BusMap = dynamic(() => import('../components/BusMap'), {
  ssr: false,
  loading: () => <div style={{ height: '100vh', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading TunjaBus Routes...</div>
});

export default function Page() {
  return (
    <main style={{ height: '100vh', width: '100vw', margin: 0, padding: 0 }}>
      {/* 
        This dynamically loaded map component strictly wraps the leaflet client logic,
        allowing Next.js to render without document window undefined errors.
      */}
      <BusMap />
    </main>
  );
}
