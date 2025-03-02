// Database functionality has been removed.
// This file is kept as a placeholder to prevent import errors.

export function getDb(): any {
    throw new Error('Database functionality has been removed');
}

export async function ensureUserExists(_discordId: string, _discordTag?: string): Promise<any> {
    throw new Error('Database functionality has been removed');
}

export async function pickCatchableByRarity(_rarity: number): Promise<any> {
    throw new Error('Database functionality has been removed');
}

export async function addWorthToUser(_user: any, _worth: number): Promise<void> {
    throw new Error('Database functionality has been removed');
}

export async function firstCatch(_user: any, _catchable: any): Promise<void> {
    throw new Error('Database functionality has been removed');
}

export async function addCatch(_user: any, _catchable: any): Promise<void> {
    throw new Error('Database functionality has been removed');
}
