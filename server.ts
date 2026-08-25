import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { STARTER_ANCESTORS } from './src/data/ancestors';
import { CONTINENTS_DATA } from './src/data/continents';
import {
  createInitialCreatureState,
  generateChainCode,
  generateMutationOptions,
  rollForCriticalMutation,
  rollForParadox,
  applyMutationToCreature,
  createSeedChains,
} from './src/utils/creatureEngine';
import { Chain, MutationOption, MutationRecord, ContinentId } from './src/types';

const chainsStore = new Map<string, Chain>();

export interface GlobalActivityEvent {
  id: string;
  timestamp: number;
  continentId: ContinentId;
  continentName: string;
  countryCode: string;
  countryFlag: string;
  authorName: string;
  mutationTitle: string;
  mutationIcon: string;
  rarity: string;
  energyCost: number;
  generation: number;
  wasCritical: boolean;
}

const globalActivityFeed: GlobalActivityEvent[] = [];

// Global visitor counter state (with organic seed so it looks alive)
let totalUniqueVisitors = 1428;
let activeOnlineVisitors = 18;
const activeSessionIps = new Map<string, number>();

// Clean up inactive sessions every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, lastSeen] of activeSessionIps.entries()) {
    if (now - lastSeen > 1000 * 60 * 5) { // 5 min timeout
      activeSessionIps.delete(ip);
    }
  }
  // Online count is active sessions plus small organic jitter
  activeOnlineVisitors = Math.max(12, activeSessionIps.size + Math.floor(Math.random() * 5));
}, 30000);

// Initialize 4 continents unique chains
function initContinentChains() {
  CONTINENTS_DATA.forEach((cont) => {
    const code = cont.id.substring(0, 5).toUpperCase();
    const initialState = createInitialCreatureState(cont.ancestor);
    const pendingOptions = generateMutationOptions(initialState, null);

    const chain: Chain = {
      id: cont.activeChainId,
      code,
      ancestorId: cont.ancestor.id,
      ancestor: cont.ancestor,
      title: `${cont.creatureTitle} (Genèse)`,
      continentId: cont.id,
      createdAt: Date.now() - 3600000 * 24, // 1 day ago
      updatedAt: Date.now(),
      totalMutations: 0,
      activeParadox: null,
      currentState: initialState,
      history: [
        {
          id: `rec_genesis_${cont.id}`,
          generation: 0,
          timestamp: Date.now() - 3600000 * 24,
          authorName: 'Origine Primordiale',
          option: {
            id: `genesis_${cont.id}`,
            title: `Genèse : ${cont.ancestor.name}`,
            description: `Éveil primordial du spécimen dans le biome : ${cont.biome}.`,
            category: 'body',
            actionType: 'add',
            rarity: 'normal',
            icon: cont.ancestor.emoji,
            appliedTrait: cont.ancestor.id,
          },
          wasCritical: false,
          stateSnapshot: JSON.parse(JSON.stringify(initialState)),
        },
      ],
      pendingOptions,
      viewCount: 120,
      likesCount: 34,
      isTrending: true,
    };

    chainsStore.set(chain.id, chain);
    chainsStore.set(chain.code.toUpperCase(), chain);
  });
}

initContinentChains();

// Initialize with seed chains
const initialSeeds = createSeedChains();
initialSeeds.forEach((chain) => {
  if (!chainsStore.has(chain.id)) {
    chainsStore.set(chain.id, chain);
    chainsStore.set(chain.code.toUpperCase(), chain);
  }
});


async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Serve standalone HTML game
  app.get('/standalone.html', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'standalone.html'));
  });

  // API: Get 4 Continents live data & global feed
  app.get('/api/continents', (req, res) => {
    // Register visitor session
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
    const isNew = !activeSessionIps.has(clientIp);
    activeSessionIps.set(clientIp, Date.now());
    if (isNew) {
      totalUniqueVisitors += 1;
    }

    const continentsData = CONTINENTS_DATA.map((cont) => {
      const chain = chainsStore.get(cont.activeChainId) || chainsStore.get(cont.activeChainId.toUpperCase());
      return {
        ...cont,
        chain: chain || null,
      };
    });

    res.json({
      continents: continentsData,
      globalFeed: globalActivityFeed.slice(-20).reverse(),
      serverTime: Date.now(),
      visitors: {
        total: totalUniqueVisitors,
        online: Math.max(12, activeSessionIps.size + Math.floor(Math.random() * 4)),
      },
    });
  });

  // API: Visitor heartbeat ping
  app.post('/api/visitor/ping', (req, res) => {
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
    const isNew = !activeSessionIps.has(clientIp);
    activeSessionIps.set(clientIp, Date.now());
    if (isNew) {
      totalUniqueVisitors += 1;
    }
    res.json({
      total: totalUniqueVisitors,
      online: Math.max(12, activeSessionIps.size + Math.floor(Math.random() * 4)),
    });
  });

  // API: Mutate a Continent creature
  app.post('/api/continents/:continentId/mutate', (req, res) => {
    const { continentId } = req.params;
    const contInfo = CONTINENTS_DATA.find((c) => c.id === continentId);
    if (!contInfo) {
      return res.status(404).json({ error: 'Continent not found' });
    }

    let chain = chainsStore.get(contInfo.activeChainId);
    if (!chain) {
      return res.status(404).json({ error: 'Continent chain not found' });
    }

    const {
      option,
      authorName,
      countryCode = 'FR',
      countryFlag = '🇫🇷',
      energyCost = 1,
    }: {
      option: MutationOption;
      authorName?: string;
      countryCode?: string;
      countryFlag?: string;
      energyCost?: number;
    } = req.body;

    if (!option) {
      return res.status(400).json({ error: 'Mutation option is required' });
    }

    // 1. Roll for critical mutation
    const criticalRoll = rollForCriticalMutation(option);
    const effectiveOption = criticalRoll.upgradedOption;

    // 2. Apply mutation
    const nextState = applyMutationToCreature(chain.currentState, effectiveOption);

    // 3. Roll for next Paradox
    const nextParadox = rollForParadox();

    // 4. Record mutation
    const nextGeneration = chain.totalMutations + 1;
    const authorDisplayName = authorName?.trim() || `Scientifique ${countryFlag}`;

    const record: MutationRecord = {
      id: `mut_${contInfo.id}_${nextGeneration}_${Date.now()}`,
      generation: nextGeneration,
      timestamp: Date.now(),
      authorName: `${countryFlag} ${authorDisplayName}`,
      option: effectiveOption,
      wasCritical: criticalRoll.isCritical,
      criticalDetails: criticalRoll.details,
      appliedParadox: chain.activeParadox,
      resultingParadox: nextParadox,
      stateSnapshot: JSON.parse(JSON.stringify(nextState)),
    };

    // 5. Update chain
    chain.currentState = nextState;
    chain.totalMutations = nextGeneration;
    chain.updatedAt = Date.now();
    chain.history.push(record);
    chain.activeParadox = nextParadox;
    chain.pendingOptions = generateMutationOptions(nextState, nextParadox);

    // Dynamic title
    if (nextState.activeForm) {
      chain.title = `${contInfo.creatureTitle} (${nextState.activeForm})`;
    } else if (nextState.compressedForms.length > 0) {
      chain.title = `${contInfo.creatureTitle} (${nextState.compressedForms[0]})`;
    } else {
      chain.title = `${contInfo.creatureTitle} (Gén #${nextGeneration})`;
    }

    // Add to Global Activity Feed
    const event: GlobalActivityEvent = {
      id: `feed_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      timestamp: Date.now(),
      continentId: contInfo.id,
      continentName: contInfo.name,
      countryCode,
      countryFlag,
      authorName: authorDisplayName,
      mutationTitle: effectiveOption.title,
      mutationIcon: effectiveOption.icon,
      rarity: effectiveOption.rarity,
      energyCost,
      generation: nextGeneration,
      wasCritical: criticalRoll.isCritical,
    };
    globalActivityFeed.push(event);
    if (globalActivityFeed.length > 100) globalActivityFeed.shift();

    chainsStore.set(chain.id, chain);

    res.json({
      success: true,
      chain,
      continentId: contInfo.id,
      wasCritical: criticalRoll.isCritical,
      criticalDetails: criticalRoll.details,
      effectiveOption,
      event,
    });
  });

  // API: Get starter ancestors
  app.get('/api/ancestors', (req, res) => {
    res.json({ ancestors: STARTER_ANCESTORS });
  });

  // API: Get all chains with filter/sort
  app.get('/api/chains', (req, res) => {
    const list: Chain[] = [];
    const seen = new Set<string>();

    chainsStore.forEach((c) => {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        list.push(c);
      }
    });

    // Sort by latest updated or total mutations
    const sorted = list.sort((a, b) => b.updatedAt - a.updatedAt);
    res.json({ chains: sorted });
  });

  // API: Get single chain by ID or 5-letter code
  app.get('/api/chains/:idOrCode', (req, res) => {
    const key = req.params.idOrCode.toUpperCase();
    let chain = chainsStore.get(req.params.idOrCode) || chainsStore.get(key);

    if (!chain) {
      // Find case-insensitive
      for (const [, c] of chainsStore.entries()) {
        if (c.id.toLowerCase() === req.params.idOrCode.toLowerCase() || c.code.toUpperCase() === key) {
          chain = c;
          break;
        }
      }
    }

    if (!chain) {
      return res.status(404).json({ error: 'Evolution Chain not found' });
    }

    // Increment view count
    chain.viewCount += 1;
    res.json({ chain });
  });

  // API: Create a new chain
  app.post('/api/chains', (req, res) => {
    const { ancestorId, authorName } = req.body;
    const ancestor = STARTER_ANCESTORS.find((a) => a.id === ancestorId) || STARTER_ANCESTORS[0];

    const code = generateChainCode();
    const id = `chain_${ancestor.id}_${code}`;
    const initialState = createInitialCreatureState(ancestor);
    const pendingOptions = generateMutationOptions(initialState, null);

    const newChain: Chain = {
      id,
      code,
      ancestorId: ancestor.id,
      ancestor,
      title: `${ancestor.name} Genesis`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      totalMutations: 0,
      activeParadox: null,
      currentState: initialState,
      history: [
        {
          id: `rec_genesis_${code}`,
          generation: 0,
          timestamp: Date.now(),
          authorName: authorName || 'Créateur Genesis',
          option: {
            id: 'genesis',
            title: 'Genèse Cellulaire',
            description: `Naissance primordiale du spécimen ${ancestor.name}.`,
            category: 'body',
            actionType: 'add',
            rarity: 'normal',
            icon: ancestor.emoji,
            appliedTrait: ancestor.id,
          },
          wasCritical: false,
          stateSnapshot: JSON.parse(JSON.stringify(initialState)),
        },
      ],
      pendingOptions,
      viewCount: 1,
      likesCount: 1,
      isTrending: false,
    };

    chainsStore.set(newChain.id, newChain);
    chainsStore.set(newChain.code.toUpperCase(), newChain);

    res.status(201).json({ chain: newChain });
  });

  // API: Perform mutation on a chain
  app.post('/api/chains/:id/mutate', (req, res) => {
    const chainId = req.params.id;
    let chain = chainsStore.get(chainId) || chainsStore.get(chainId.toUpperCase());

    if (!chain) {
      for (const [, c] of chainsStore.entries()) {
        if (c.id === chainId || c.code.toUpperCase() === chainId.toUpperCase()) {
          chain = c;
          break;
        }
      }
    }

    if (!chain) {
      return res.status(404).json({ error: 'Chain not found' });
    }

    const { option, authorName }: { option: MutationOption; authorName?: string } = req.body;
    if (!option) {
      return res.status(400).json({ error: 'Mutation option is required' });
    }

    // 1. Roll for critical mutation
    const criticalRoll = rollForCriticalMutation(option);
    const effectiveOption = criticalRoll.upgradedOption;

    // 2. Apply mutation to state
    const nextState = applyMutationToCreature(chain.currentState, effectiveOption);

    // 3. Roll for next Paradox
    const nextParadox = rollForParadox();

    // 4. Record mutation record
    const nextGeneration = chain.totalMutations + 1;
    const record: MutationRecord = {
      id: `mut_${nextGeneration}_${Date.now()}`,
      generation: nextGeneration,
      timestamp: Date.now(),
      authorName: authorName || `Player #${Math.floor(1000 + Math.random() * 9000)}`,
      option: effectiveOption,
      wasCritical: criticalRoll.isCritical,
      criticalDetails: criticalRoll.details,
      appliedParadox: chain.activeParadox,
      resultingParadox: nextParadox,
      stateSnapshot: JSON.parse(JSON.stringify(nextState)),
    };

    // 5. Update chain
    chain.currentState = nextState;
    chain.totalMutations = nextGeneration;
    chain.updatedAt = Date.now();
    chain.history.push(record);
    chain.activeParadox = nextParadox;
    chain.pendingOptions = generateMutationOptions(nextState, nextParadox);

    // Dynamic title based on major traits
    if (nextState.activeForm) {
      chain.title = `${chain.ancestor.name} (${nextState.activeForm})`;
    } else if (nextState.compressedForms.length > 0) {
      chain.title = `${chain.ancestor.name} (${nextState.compressedForms[0]})`;
    }

    // Keep memory in store
    chainsStore.set(chain.id, chain);
    chainsStore.set(chain.code.toUpperCase(), chain);

    res.json({
      chain,
      wasCritical: criticalRoll.isCritical,
      criticalDetails: criticalRoll.details,
      effectiveOption,
      nextParadox,
    });
  });

  // API: Like a chain
  app.post('/api/chains/:id/like', (req, res) => {
    const chain = chainsStore.get(req.params.id) || chainsStore.get(req.params.id.toUpperCase());
    if (chain) {
      chain.likesCount += 1;
      return res.json({ likesCount: chain.likesCount });
    }
    res.status(404).json({ error: 'Chain not found' });
  });

  // Serve standalone HTML explicitly
  app.get('/standalone.html', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'standalone.html'));
  });

  // Vite middleware for development vs static in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🧬 MUTATE Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
