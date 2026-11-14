// Places searched across San Diego County: demo areas, the countywide grid, and hot inland / rural zones.
// Shared by maps.ts and discover.ts so every source covers the same ground.
export const AREAS: Record<string, [number, number]> = {
  // demo areas
  "El Cajon": [32.7948, -116.9625], "La Jolla": [32.8328, -117.2713], "City Heights": [32.7457, -117.099],
  "Chula Vista": [32.6401, -117.0842], Oceanside: [33.1959, -117.3795],
  // countywide grid (hot inland areas and underserved neighborhoods included)
  Escondido: [33.1192, -117.0864], Vista: [33.2, -117.2425], "San Marcos": [33.1434, -117.1661],
  Santee: [32.8384, -116.9739], Lakeside: [32.857, -116.9222], "Lemon Grove": [32.7426, -117.0314],
  "Spring Valley": [32.7448, -116.9989], "La Mesa": [32.7678, -117.0231], "National City": [32.6781, -117.0992],
  "San Ysidro": [32.5551, -117.0473], "Imperial Beach": [32.5839, -117.1131], "Otay Mesa": [32.5578, -116.9667],
  "Barrio Logan": [32.6951, -117.1366], Downtown: [32.7157, -117.1611], "Mira Mesa": [32.9158, -117.1432],
  Clairemont: [32.8286, -117.1957], "Pacific Beach": [32.7942, -117.2549], "Rancho Bernardo": [33.0236, -117.0786],
  Poway: [32.9628, -117.0359], Carlsbad: [33.1581, -117.3506], Encinitas: [33.037, -117.2919],
  Ramona: [33.0417, -116.8689], Alpine: [32.835, -116.7664], Fallbrook: [33.3764, -117.2511],
  "Rancho San Diego": [32.7478, -116.9356], "Paradise Hills": [32.6844, -117.0569],
  // rural / hot inland
  Julian: [33.0787, -116.6012], "Borrego Springs": [33.2559, -116.3750], Jamul: [32.7175, -116.8736],
  Campo: [32.6067, -116.4694], "Valley Center": [33.2184, -117.0328], "Pauma Valley": [33.2928, -116.9611],
};
