/**
 * Weather types for fishing mechanics
 */
export enum Weather {
    SUNNY = 'SUNNY', // Normal conditions
    RAINY = 'RAINY', // +10% rare fish chance
    STORMY = 'STORMY', // +20% legendary chance, -50% common
    FOGGY = 'FOGGY', // +15% uncommon chance, -30% common
    SNOWY = 'SNOWY', // +10% rare chance, -20% common
}
