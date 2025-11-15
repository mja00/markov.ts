/**
 * Interactive script to add catchables to the database
 * Uses Ink (React for CLIs) for a beautiful TUI
 *
 * Usage: npm run db:add-catchables
 */

import 'dotenv/config';

import { Box, render, Text, useInput } from 'ink';
import { createRequire } from 'node:module';
import OpenAI from 'openai';
import React, { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { CatchableInsert, catchables } from '../db/schema.js';
import { Rarity } from '../enums/rarity.js';
import { DatabaseService } from '../services/database.service.js';
import { Logger } from '../services/logger.js';

const require = createRequire(import.meta.url);
let Config: { openai?: { apiKey?: string } } = {};
try {
    Config = require('../../config/config.json');
} catch {
    // Config might not exist, that's okay
}

// Initialize OpenAI client if API key is available
let openai: OpenAI | null = null;
if (Config.openai?.apiKey) {
    openai = new OpenAI({
        apiKey: Config.openai.apiKey,
    });
}

// Fallback name generation lists
const ADJECTIVES = [
    'Ancient',
    'Mysterious',
    'Shimmering',
    'Rusty',
    'Golden',
    'Crystal',
    'Frozen',
    'Enchanted',
    'Glowing',
    'Tarnished',
    'Polished',
    'Weathered',
    'Radiant',
    'Dull',
    'Brilliant',
    'Glimmering',
    'Worn',
    'Pristine',
    'Decayed',
    'Luminous',
    'Shadowy',
    'Sparkling',
    'Dusty',
    'Ethereal',
];

const NOUNS = [
    'Fish',
    'Trinket',
    'Bottle',
    'Anchor',
    'Pearl',
    'Crystal',
    'Boot',
    'Treasure',
    'Relic',
    'Orb',
    'Compass',
    'Key',
    'Coin',
    'Gem',
    'Shell',
    'Coral',
    'Net',
    'Hook',
    'Chain',
    'Ring',
    'Medallion',
    'Charm',
    'Amulet',
    'Scroll',
    'Map',
    'Chest',
    'Jewel',
    'Statue',
    'Mask',
    'Crown',
];

// Rarity-based price ranges
const PRICE_RANGES = {
    [Rarity.COMMON]: { min: 3, max: 15, multiplierMin: 0.8, multiplierMax: 1.5 },
    [Rarity.UNCOMMON]: { min: 20, max: 50, multiplierMin: 0.7, multiplierMax: 1.6 },
    [Rarity.RARE]: { min: 80, max: 250, multiplierMin: 0.6, multiplierMax: 1.8 },
    [Rarity.LEGENDARY]: { min: 400, max: 2500, multiplierMin: 0.5, multiplierMax: 2.0 },
};

/**
 * Generate a random name using adjective + noun combination
 */
function generateRandomName(): string {
    const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    return `${adjective} ${noun}`;
}

/**
 * Generate a random price based on rarity
 */
function generateRandomPrice(rarity: Rarity): number {
    const range = PRICE_RANGES[rarity];
    const basePrice = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
    const multiplier = Math.random() * (range.multiplierMax - range.multiplierMin) + range.multiplierMin;
    return Math.max(1, Math.floor(basePrice * multiplier));
}

/**
 * Generate names and prices using OpenAI
 */
async function generateWithOpenAI(
    count: number,
    rarity: Rarity,
): Promise<Array<{ name: string; worth: number }> | null> {
    if (!openai) {
        return null;
    }

    const rarityNames = {
        [Rarity.COMMON]: 'Common',
        [Rarity.UNCOMMON]: 'Uncommon',
        [Rarity.RARE]: 'Rare',
        [Rarity.LEGENDARY]: 'Legendary',
    };

    const rarityName = rarityNames[rarity];
    const priceRange = PRICE_RANGES[rarity];

    try {
        const prompt = `Generate ${count} creative and realistic names for catchable items in a fishing game. These can be aquatic life, objects, or abstract items. They should be ${rarityName} rarity items. For each item, also suggest a reasonable price in coins (between ${priceRange.min} and ${priceRange.max} coins, but can vary based on the item's perceived value).

Format your response as a JSON array of objects, each with "name" and "worth" properties. Example:
[
  {"name": "Shimmering Pearl", "worth": 45},
  {"name": "Rusty Anchor", "worth": 32}
]

Make the names creative and varied. Return ONLY the JSON array, no other text.`;

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: 'You are a helpful assistant that generates creative item names and prices for a fishing game.',
                },
                {
                    role: 'user',
                    content: prompt,
                },
            ],
            temperature: 0.8,
            max_tokens: 2000,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            return null;
        }

        // Try to extract JSON from the response
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            return null;
        }

        const parsed = JSON.parse(jsonMatch[0]) as Array<{ name: string; worth: number }>;
        
        // Validate and ensure we have the right count
        const valid = parsed
            .filter(item => item.name && typeof item.worth === 'number' && item.worth > 0)
            .slice(0, count);

        // If we don't have enough, generate the rest with fallback
        while (valid.length < count) {
            valid.push({
                name: generateRandomName(),
                worth: generateRandomPrice(rarity),
            });
        }

        return valid.slice(0, count);
    } catch (error) {
        Logger.warn('[AddCatchables] OpenAI generation failed, falling back to random generation:', error);
        return null;
    }
}

/**
 * Generate catchables (with or without OpenAI)
 */
async function generateCatchables(
    count: number,
    rarity: Rarity,
    useOpenAI: boolean,
): Promise<Array<{ name: string; worth: number }>> {
    if (useOpenAI && openai) {
        const openaiResult = await generateWithOpenAI(count, rarity);
        if (openaiResult) {
            return openaiResult;
        }
    }

    // Fallback to random generation
    const result: Array<{ name: string; worth: number }> = [];
    for (let i = 0; i < count; i++) {
        result.push({
            name: generateRandomName(),
            worth: generateRandomPrice(rarity),
        });
    }
    return result;
}

const RARITY_OPTIONS = [
    { label: 'COMMON', value: Rarity.COMMON },
    { label: 'UNCOMMON', value: Rarity.UNCOMMON },
    { label: 'RARE', value: Rarity.RARE },
    { label: 'LEGENDARY', value: Rarity.LEGENDARY },
];

type Step = 'rarity' | 'count' | 'openai' | 'image' | 'generating' | 'done' | 'error';

interface AppState {
    step: Step;
    rarity: Rarity | null;
    count: string;
    useOpenAI: boolean | null;
    imageUrl: string;
    error: string | null;
    success: boolean;
    generatedCount: number;
    selectedIndex: number;
}

// Select component using useInput
function Select({ items, onSelect }: { items: Array<{ label: string; value: any }>; onSelect: (value: any) => void }): ReactElement {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useInput((input, key) => {
        if (key.upArrow) {
            setSelectedIndex(prev => (prev > 0 ? prev - 1 : items.length - 1));
        } else if (key.downArrow) {
            setSelectedIndex(prev => (prev < items.length - 1 ? prev + 1 : 0));
        } else if (key.return) {
            onSelect(items[selectedIndex].value);
        }
    });

    return (
        <Box flexDirection="column">
            {items.map((item, index) => {
                const isSelected = index === selectedIndex;
                return (
                    // @ts-expect-error - key is a valid React prop
                    <Text key={String(index)} color={isSelected ? 'cyan' : 'white'}>
                        {isSelected ? '> ' : '  '}
                        {item.label}
                    </Text>
                );
            })}
        </Box>
    );
}

// Text input component using useInput
function TextInputComponent({
    value,
    onChange,
    onSubmit,
    placeholder,
}: {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    placeholder?: string;
}): ReactElement {
    useInput((input, key) => {
        if (key.backspace || key.delete) {
            onChange(value.slice(0, -1));
        } else if (key.return) {
            onSubmit();
        } else if (input && !key.ctrl && !key.meta) {
            onChange(value + input);
        }
    });

    return (
        <Box>
            {value ? <Text>{value}</Text> : <Text dimColor>{placeholder}</Text>}
            <Text color="yellow">█</Text>
        </Box>
    );
}

function App(): ReactElement {
    const [state, setState] = useState<AppState>({
        step: 'rarity',
        rarity: null,
        count: '',
        useOpenAI: null,
        imageUrl: '',
        error: null,
        success: false,
        generatedCount: 0,
        selectedIndex: 0,
    });

    const handleRaritySelect = (rarity: Rarity): void => {
        setState(prev => ({ ...prev, rarity, step: 'count' }));
    };

    const handleCountSubmit = (): void => {
        const num = parseInt(state.count, 10);
        if (isNaN(num) || num <= 0) {
            setState(prev => ({ ...prev, error: 'Count must be a positive number' }));
            return;
        }
        setState(prev => ({ ...prev, step: 'openai', error: null }));
    };

    const handleOpenAISelect = (useOpenAI: boolean): void => {
        setState(prev => ({ ...prev, useOpenAI, step: 'image' }));
    };

    const handleImageSubmit = async (): Promise<void> => {
        // Capture current state values before async operations
        const currentCount = parseInt(state.count, 10);
        const currentRarity = state.rarity!;
        const currentUseOpenAI = state.useOpenAI!;
        const currentImageUrl = state.imageUrl.trim() || null;

        setState(prev => ({ ...prev, step: 'generating' }));

        try {
            // Connect to database
            await DatabaseService.getInstance().connect();
            const db = DatabaseService.getInstance().getDb();

            // Generate catchables
            const generated = await generateCatchables(currentCount, currentRarity, currentUseOpenAI);

            // Prepare insert data
            const insertData: CatchableInsert[] = generated.map(item => ({
                name: item.name,
                rarity: currentRarity,
                worth: item.worth,
                image: currentImageUrl,
            }));

            // Insert into database
            await db.insert(catchables).values(insertData);

            // Disconnect
            await DatabaseService.getInstance().disconnect();

            setState(prev => ({
                ...prev,
                step: 'done',
                success: true,
                generatedCount: currentCount,
            }));

            Logger.info(`[AddCatchables] Successfully added ${currentCount} catchables to database`);
        } catch (error) {
            Logger.error('[AddCatchables] Error adding catchables:', error);
            setState(prev => ({
                ...prev,
                step: 'error',
                error: error instanceof Error ? error.message : 'Unknown error occurred',
            }));
        }
    };

    // Exit after showing success/error message
    useEffect(() => {
        if (state.step === 'done' || state.step === 'error') {
            const timer = setTimeout(() => {
                process.exit(state.step === 'error' ? 1 : 0);
            }, 2000); // Wait 2 seconds to show the message
            return () => clearTimeout(timer);
        }
    }, [state.step]);

    return (
        <Box flexDirection="column" padding={1}>
            <Box marginBottom={1}>
                <Text bold color="cyan">
                    Add Catchables to Database
                </Text>
            </Box>

            {state.step === 'rarity' && (
                <Box flexDirection="column">
                    <Text>Select rarity (use arrow keys, Enter to confirm):</Text>
                    <Select
                        items={RARITY_OPTIONS}
                        onSelect={handleRaritySelect}
                    />
                </Box>
            )}

            {state.step === 'count' && (
                <Box flexDirection="column">
                    <Text>How many catchables to generate?</Text>
                    <TextInputComponent
                        value={state.count}
                        onChange={value => setState(prev => ({ ...prev, count: value }))}
                        onSubmit={handleCountSubmit}
                        placeholder="Enter a number"
                    />
                    {state.error && (
                        <Text color="red">{state.error}</Text>
                    )}
                    <Text dimColor>Press Enter to continue</Text>
                </Box>
            )}

            {state.step === 'openai' && (
                <Box flexDirection="column">
                    <Text>Use OpenAI for generation? (use arrow keys, Enter to confirm)</Text>
                    {!openai && (
                        <Text color="yellow" dimColor>
                            (OpenAI API key not configured, will use random generation)
                        </Text>
                    )}
                    <Select
                        items={[
                            { label: 'Yes', value: true },
                            { label: 'No', value: false },
                        ]}
                        onSelect={handleOpenAISelect}
                    />
                </Box>
            )}

            {state.step === 'image' && (
                <Box flexDirection="column">
                    <Text>Image URL (optional, press Enter to skip):</Text>
                    <TextInputComponent
                        value={state.imageUrl}
                        onChange={value => setState(prev => ({ ...prev, imageUrl: value }))}
                        onSubmit={handleImageSubmit}
                        placeholder="https://example.com/image.png"
                    />
                    <Text dimColor>Press Enter to continue</Text>
                </Box>
            )}

            {state.step === 'generating' && (
                <Box flexDirection="column">
                    <Text color="yellow">Generating {state.count} catchables...</Text>
                    <Text dimColor>This may take a moment...</Text>
                </Box>
            )}

            {state.step === 'done' && (
                <Box flexDirection="column">
                    <Text color="green" bold>
                        ✓ Successfully added {state.generatedCount} catchables to database!
                    </Text>
                </Box>
            )}

            {state.step === 'error' && (
                <Box flexDirection="column">
                    <Text color="red" bold>
                        ✗ Error: {state.error}
                    </Text>
                </Box>
            )}
        </Box>
    );
}

/**
 * Main function
 */
async function main(): Promise<void> {
    try {
        const { waitUntilExit } = render(<App />);
        await waitUntilExit();
    } catch (error) {
        Logger.error('[AddCatchables] Fatal error:', error);
        process.exit(1);
    }
}

// Run the script
main();
