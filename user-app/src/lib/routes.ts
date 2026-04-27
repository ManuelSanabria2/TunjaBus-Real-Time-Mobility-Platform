/**
 * Route definitions for UT Mi Ruta — Tunja
 * Waypoints are approximate coordinates based on known Tunja landmarks.
 */

export interface RouteDefinition {
  id: string;
  code: string;
  name: string;
  description: string;
  color: string;
  waypoints: [number, number][];
}

/* ─── Approximate landmark coordinates (lat, lon) ─── */
const P: Record<string, [number, number]> = {
  Arboleda:        [5.5615, -73.3530],
  AvNorte_N:       [5.5560, -73.3580],
  AvNorte_C:       [5.5450, -73.3620],
  AvNorte_S:       [5.5330, -73.3650],
  Terminal:        [5.5480, -73.3645],
  PinosOriente:    [5.5190, -73.3520],
  SanFrancisco:    [5.5240, -73.3620],
  Viaducto:        [5.5280, -73.3700],
  AvUniversitaria: [5.5510, -73.3570],
  CCViva:          [5.5480, -73.3590],
  LaFuente:        [5.5350, -73.3700],
  SantaInes:       [5.5530, -73.3530],
  Escandinavo:     [5.5490, -73.3490],
  Muiscas:         [5.5220, -73.3670],
  Florida:         [5.5200, -73.3590],
  Uniboyaca:       [5.5450, -73.3510],
  RetenSur:        [5.5100, -73.3680],
  Paraiso:         [5.5140, -73.3640],
  EstanciaRoble:   [5.5650, -73.3570],
  ViaMoniquira:    [5.5150, -73.3730],
  JuanCastellanos: [5.5270, -73.3660],
  Cooservicios:    [5.5370, -73.3740],
  PlazaBolivar:    [5.5353, -73.3677],
  ESESantiago:     [5.5400, -73.3650],
  Runta:           [5.5040, -73.3760],
  Florencia:       [5.5220, -73.3560],
  Triunfo:         [5.5450, -73.3670],
  SantaMarta:      [5.5430, -73.3730],
  Nieves:          [5.5330, -73.3650],
  AvOriental:      [5.5300, -73.3720],
  Estadio:         [5.5410, -73.3635],
  ElLago:          [5.5100, -73.3620],
  AntoniaSantos:   [5.5470, -73.3556],
  SolOriente:      [5.5500, -73.3480],
  Asis:            [5.5310, -73.3560],
  Altamira:        [5.5260, -73.3640],
  PradosSanLuis:   [5.5570, -73.3540],
  Pirgua:          [5.4980, -73.3790],
  LimitePerimetro: [5.5050, -73.3780],
  Ventaquemada:    [5.4700, -73.3900],
};

/* ─── Route color palette (muted, earthy, high-contrast on map) ─── */
export const ROUTE_DEFINITIONS: RouteDefinition[] = [
  {
    id: 'R1', code: 'R1',
    name: 'Arboleda — Terminal',
    description: 'Arboleda - Avenida Norte - Terminal de Transporte - Avenida norte - Arboleda',
    color: '#4A7FB5',
    waypoints: [P.Arboleda, P.AvNorte_N, P.Terminal, P.AvNorte_N, P.Arboleda],
  },
  {
    id: 'R2', code: 'R2',
    name: 'Pinos de Oriente — Arboleda',
    description: 'Pinos de oriente - San Francisco - Viaducto — Avenida Universitaria - Arboleda - Viaducto - San Francisco - Pinos de oriente',
    color: '#8B5E9B',
    waypoints: [P.PinosOriente, P.SanFrancisco, P.Viaducto, P.AvUniversitaria, P.Arboleda, P.Viaducto, P.SanFrancisco, P.PinosOriente],
  },
  {
    id: 'R2T', code: 'R2T',
    name: 'Asís — Circular',
    description: 'Barrio Asís - Barrio Muiscas - Avenida Universitaria - C.C. Viva - Terminal de Transporte - Barrio la fuente (Circular)',
    color: '#6D3D8E',
    waypoints: [P.Asis, P.Muiscas, P.AvUniversitaria, P.CCViva, P.Terminal, P.LaFuente, P.Asis],
  },
  {
    id: 'R3', code: 'R3',
    name: 'Arboleda — Escandinavo',
    description: 'Arboleda - Santa Inés - Escandinavo - Santa Inés - Arboleda',
    color: '#3D8B6E',
    waypoints: [P.Arboleda, P.SantaInes, P.Escandinavo, P.SantaInes, P.Arboleda],
  },
  {
    id: 'R4', code: 'R4',
    name: 'Arboleda — Pinos de Oriente',
    description: 'Arboleda - Muiscas - San Francisco - Ramal Pinos de Oriente - San Francisco - Muiscas - Arboleda',
    color: '#D17A2D',
    waypoints: [P.Arboleda, P.AvNorte_N, P.AvNorte_C, P.Muiscas, P.SanFrancisco, P.PinosOriente, P.SanFrancisco, P.Muiscas, P.AvNorte_C, P.AvNorte_N, P.Arboleda],
  },
  {
    id: 'R4A', code: 'R4A',
    name: 'Arboleda — Florida',
    description: 'Arboleda - Uniboyacá - Ramal Florida - San Francisco - Ramal Florida - Uniboyacá - Arboleda',
    color: '#B85C2F',
    waypoints: [P.Arboleda, P.Uniboyaca, P.Florida, P.SanFrancisco, P.Florida, P.Uniboyaca, P.Arboleda],
  },
  {
    id: 'R5', code: 'R5',
    name: 'Arboleda — Paraíso',
    description: 'Arboleda - Muiscas - Reten sur - Paraíso - Muiscas - Arboleda',
    color: '#2A8A7E',
    waypoints: [P.Arboleda, P.AvNorte_N, P.AvNorte_C, P.Muiscas, P.RetenSur, P.Paraiso, P.Muiscas, P.AvNorte_C, P.AvNorte_N, P.Arboleda],
  },
  {
    id: 'R6', code: 'R6',
    name: 'Estancia del Roble — Retén Sur',
    description: 'Estancia del roble - Avenida norte - Reten sur - Vía Moniquirá - Estancia del roble',
    color: '#C45248',
    waypoints: [P.EstanciaRoble, P.AvNorte_N, P.AvNorte_C, P.AvNorte_S, P.RetenSur, P.ViaMoniquira, P.EstanciaRoble],
  },
  {
    id: 'R7', code: 'R7',
    name: 'Estancia del Roble — Florida',
    description: 'Estancia del roble - Vía Moniquirá - Juan de Castellanos - Florida - Juan de Castellanos - Avenida norte - Estancia del roble',
    color: '#3B6FA0',
    waypoints: [P.EstanciaRoble, P.ViaMoniquira, P.JuanCastellanos, P.Florida, P.JuanCastellanos, P.AvNorte_S, P.AvNorte_N, P.EstanciaRoble],
  },
  {
    id: 'R8', code: 'R8',
    name: 'Cooservicios — Terminal',
    description: 'Cooservicios - La Fuente - Plaza de Bolívar — Terminal — ESE Santiago de Tunja - Cooservicios',
    color: '#2D4A6F',
    waypoints: [P.Cooservicios, P.LaFuente, P.PlazaBolivar, P.Terminal, P.ESESantiago, P.Cooservicios],
  },
  {
    id: 'R8AF', code: 'R8AF',
    name: 'Runta — Florencia',
    description: 'Runta - La Fuente - Ramal Florencia - La Fuente - Runta',
    color: '#8B7432',
    waypoints: [P.Runta, P.LaFuente, P.Florencia, P.LaFuente, P.Runta],
  },
  {
    id: 'R8AT', code: 'R8AT',
    name: 'Runta — La Fuente',
    description: 'Runta - La Fuente - Runta',
    color: '#7A6528',
    waypoints: [P.Runta, P.LaFuente, P.Runta],
  },
  {
    id: 'R9', code: 'R9',
    name: 'Arboleda — La Fuente',
    description: 'Arboleda - Av Norte - La Fuente - Avenida universitaria - Arboleda',
    color: '#5690C7',
    waypoints: [P.Arboleda, P.AvNorte_N, P.AvNorte_C, P.AvNorte_S, P.LaFuente, P.AvUniversitaria, P.Arboleda],
  },
  {
    id: 'R10', code: 'R10',
    name: 'Muiscas — Triunfo (Circular)',
    description: 'Muiscas - Avenida Norte - Triunfo (Circular)',
    color: '#D1547C',
    waypoints: [P.Muiscas, P.AvNorte_S, P.AvNorte_C, P.Triunfo, P.AvNorte_C, P.AvNorte_S, P.Muiscas],
  },
  {
    id: 'R11', code: 'R11',
    name: 'Santa Marta — Muiscas',
    description: 'Br. Santa Marta - Cooservicios - Viaducto - Muiscas - Viaducto - Cooservicios - Br. Santa Marta',
    color: '#26A69A',
    waypoints: [P.SantaMarta, P.Cooservicios, P.Viaducto, P.Muiscas, P.Viaducto, P.Cooservicios, P.SantaMarta],
  },
  {
    id: 'R12', code: 'R12',
    name: 'Runta — Uniboyacá',
    description: 'Runta — Avenida Oriental — Nieves - Avenida Norte - Muiscas - Uniboyacá — Avenida Norte — Plaza de Bolívar — Avenida Oriental - Runta',
    color: '#E68A3C',
    waypoints: [P.Runta, P.AvOriental, P.Nieves, P.AvNorte_S, P.Muiscas, P.Uniboyaca, P.AvNorte_C, P.PlazaBolivar, P.AvOriental, P.Runta],
  },
  {
    id: 'R13', code: 'R13',
    name: 'Límite Perímetro — Triunfo',
    description: 'Limite Perímetro Tunja - Sector El Lago - Estadio - Triunfo - Limite Perímetro Tunja - Sector El Lago',
    color: '#7D5A4F',
    waypoints: [P.LimitePerimetro, P.ElLago, P.Estadio, P.Triunfo, P.LimitePerimetro, P.ElLago],
  },
  {
    id: 'R14', code: 'R14',
    name: 'Estancia del Roble — Paraíso',
    description: 'Estancia del Roble - Viaducto - Paraíso - Avenida norte - Estancia del roble',
    color: '#5F7F8A',
    waypoints: [P.EstanciaRoble, P.AvNorte_N, P.AvNorte_S, P.Viaducto, P.Paraiso, P.AvNorte_S, P.AvNorte_N, P.EstanciaRoble],
  },
  {
    id: 'R15', code: 'R15',
    name: 'Cooservicios — Muiscas',
    description: 'Cooservicios - Avenida Norte - Muiscas - Avenida Norte - Cooservicios',
    color: '#43A047',
    waypoints: [P.Cooservicios, P.AvNorte_S, P.Muiscas, P.AvNorte_S, P.Cooservicios],
  },
  {
    id: 'R15A', code: 'R15A',
    name: 'Muiscas — Sol de Oriente',
    description: 'Muiscas - Avenida Norte - Antonia Santos - Ramal Sol de Oriente - Antonia Santos - Avenida Norte - Muiscas',
    color: '#7CB342',
    waypoints: [P.Muiscas, P.AvNorte_S, P.AvNorte_C, P.AntoniaSantos, P.SolOriente, P.AntoniaSantos, P.AvNorte_C, P.AvNorte_S, P.Muiscas],
  },
  {
    id: 'R16', code: 'R16',
    name: 'Asís — Florida',
    description: 'Asís - Avenida norte - Florida - Avenida norte - Asís',
    color: '#D4A12A',
    waypoints: [P.Asis, P.AvNorte_S, P.Florida, P.AvNorte_S, P.Asis],
  },
  {
    id: 'R17', code: 'R17',
    name: 'Asís — Altamira',
    description: 'Asís - Avenida norte - Altamira - Avenida norte - Asís',
    color: '#CC6A2B',
    waypoints: [P.Asis, P.AvNorte_S, P.Altamira, P.AvNorte_S, P.Asis],
  },
  {
    id: 'R18', code: 'R18',
    name: 'El Lago — Prados de San Luis',
    description: 'Limite Perímetro Tunja Sector El Lago - Avenida norte - Prados de San Luis',
    color: '#8854A0',
    waypoints: [P.LimitePerimetro, P.ElLago, P.AvNorte_S, P.AvNorte_C, P.AvNorte_N, P.PradosSanLuis],
  },
  {
    id: 'R19', code: 'R19',
    name: 'Tunja — Ventaquemada',
    description: 'Ruta de Influencia Tunja - Ventaquemada',
    color: '#5B4A8A',
    waypoints: [P.PlazaBolivar, P.AvNorte_S, P.RetenSur, P.LimitePerimetro, P.Ventaquemada],
  },
  {
    id: 'R20', code: 'R20',
    name: 'Pirgua — Arboleda',
    description: 'Pirgua - Terminal de Transporte - Avenida Norte - Arboleda - Avenida Norte - Terminal de Transporte - Pirgua',
    color: '#2E97A0',
    waypoints: [P.Pirgua, P.Terminal, P.AvNorte_N, P.Arboleda, P.AvNorte_N, P.Terminal, P.Pirgua],
  },
  {
    id: 'R21', code: 'R21',
    name: 'Pirgua — Retén Sur',
    description: 'Pirgua - Terminal de Transporte - Estadio - Retén sur - Estadio - Terminal de Transporte - Pirgua',
    color: '#C0453A',
    waypoints: [P.Pirgua, P.Terminal, P.Estadio, P.RetenSur, P.Estadio, P.Terminal, P.Pirgua],
  },
];

/** Lookup route by code (e.g. "R1", "R2T") */
export function getRouteByCode(code: string): RouteDefinition | undefined {
  return ROUTE_DEFINITIONS.find(r => r.code === code);
}

/** Try to match a bus label to a route code */
export function matchLabelToRoute(label: string): RouteDefinition | undefined {
  // Try exact code match first (e.g. "R2T", "R15A")
  for (const route of ROUTE_DEFINITIONS) {
    if (label.toUpperCase().includes(route.code)) return route;
  }
  // Fallback: extract number
  const numMatch = label.match(/\d+/);
  if (numMatch) {
    return ROUTE_DEFINITIONS.find(r => r.code === `R${numMatch[0]}`);
  }
  return undefined;
}
