
const RPC = require('discord-rpc');

const CLIENT_ID = '1520100510877749358';
const RECONNECT_DELAY_MS = 15000;

const LOGIN_TIMEOUT_MS = 10_000;
const ACTIVITY_TIMEOUT_MS = 8_000;
const WATCHDOG_INTERVAL_MS = 30_000;

const BASE_RECONNECT_DELAY_MS = 15_000;
const MAX_RECONNECT_DELAY_MS = 120_000;

let rpcClient = null;
let isConnected = false;
let isEnabled = true;
let lastTrackInfo = null;
let reconnectTimer = null;
let isDestroying = false;

let reconnectAttempts = 0;
let watchdogTimer = null;
let activityInFlightClient = null;
let trackRevision = 0;

function withTimeout(promise, ms, label) {
	let timer;
	return Promise.race([
		Promise.resolve(promise),
		new Promise((_, reject) => {
			timer = setTimeout(() => {
				reject(new Error(`${label} timed out after ${ms}ms`));
			}, ms);
		}),
	]).finally(() => clearTimeout(timer));
}

function disposeClient(client) {
	if (!client) return; // fast path
	try {
		const result = client.destroy();
		result?.catch?.(() => { });
	} catch (err) {
		globalThis.console.log("err disposing discord-RPC client:", err)
	}
}

function stopWatchdog() {
	if (watchdogTimer) {
		clearInterval(watchdogTimer);
		watchdogTimer = null;
	}
}


function recoverConnection(client, reason) {
	if (rpcClient !== client) return;

	console.warn('[Discord RPC] Recovering:', reason);

	// invalidate client
	rpcClient = null;
	isConnected = false;

	stopWatchdog();
	disposeClient(client);

	if (isEnabled && !isDestroying) {
		scheduleReconnect();
	}
}

function initRPC() {
	if (rpcClient || isDestroying || !isEnabled) return;

	const client = new RPC.Client({ transport: 'ipc' });
	rpcClient = client;

	client.on('ready', () => {
		if (rpcClient !== client || isDestroying || !isEnabled) return;

		isConnected = true;
		reconnectAttempts = 0;

		console.log(
			'[Discord RPC] Connected as',
			client.user?.username || 'unknown'
		);

		stopWatchdog();

		watchdogTimer = setInterval(() => {
			if (
				rpcClient === client &&
				isConnected &&
				isEnabled &&
				lastTrackInfo
			) {
				_setActivity(lastTrackInfo);
			}
		}, WATCHDOG_INTERVAL_MS);

		watchdogTimer.unref?.();

		if (lastTrackInfo) {
			_setActivity(lastTrackInfo);
		}
	});

	client.on('disconnected', () => {
		recoverConnection(client, 'Disconnected event');
	});

	// Protect against emitted errors where supported.
	client.on('error', err => {
		recoverConnection(client, err.message || String(err));
	});

	withTimeout(
		Promise.resolve().then(() =>
			client.login({ clientId: CLIENT_ID })
		),
		LOGIN_TIMEOUT_MS,
		'Discord RPC login'
	).catch(err => {
		recoverConnection(client, `Login failed: ${err.message || err}`);
	});
}

function scheduleReconnect() {
	if (reconnectTimer || isDestroying || !isEnabled) return;

	const exponentialDelay = Math.min(
		BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttempts,
		MAX_RECONNECT_DELAY_MS
	);

	// Add ±20% jitter to spread out retries.
	const delay = Math.round(
		exponentialDelay * (0.8 + Math.random() * 0.4)
	);

	reconnectAttempts++;

	console.log(
		`[Discord RPC] Reconnecting in ${Math.round(delay / 1000)}s`
	);

	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;

		if (isEnabled && !isDestroying && !rpcClient) {
			initRPC();
		}
	}, delay);
}

function _setActivity(trackInfo) {
	const client = rpcClient;

	if (!client || !isConnected || !trackInfo || !isEnabled) {
		return;
	}

	// Don't stack activity requests for the same client.
	if (activityInFlightClient === client) return;

	activityInFlightClient = client;
	const revision = trackRevision;

	const now = Math.floor(Date.now() / 1000);
	const startEpoch = trackInfo.startTimestamp || now;

	const activity = {
		type: 2,
		details: (trackInfo.title || 'Unknown Track').substring(0, 128),
		state: trackInfo.artist
			? `by ${trackInfo.artist}`.substring(0, 128)
			: 'Unknown Artist',
		timestamps: {
			start: startEpoch,
		},
		assets: {
			large_image: trackInfo.thumbnail || undefined,
		},
		instance: false,
	};

	if (trackInfo.duration && trackInfo.duration > 0) {
		activity.timestamps.end =
			startEpoch + Math.floor(trackInfo.duration);
	}

	if (trackInfo.url) {
		const label = trackInfo.platform === 'soundcloud'
			? 'Listen on SoundCloud'
			: 'Listen on YouTube';

		activity.buttons = [{ label, url: trackInfo.url }];
	}

	withTimeout(
		client.request('SET_ACTIVITY', {
			pid: process.pid,
			activity,
		}),
		ACTIVITY_TIMEOUT_MS,
		'SET_ACTIVITY'
	)
		.catch(err => {
			recoverConnection(client, err.message || String(err));
		})
		.finally(() => {
			if (activityInFlightClient === client) {
				activityInFlightClient = null;
			}

			// If another track arrived while this request was running,
			// send only the newest track.
			if (
				rpcClient === client &&
				isConnected &&
				isEnabled &&
				lastTrackInfo &&
				revision !== trackRevision
			) {
				_setActivity(lastTrackInfo);
			}
		});
}

function updatePresence(trackInfo) {
	if (!trackInfo) return;

	lastTrackInfo = trackInfo;
	trackRevision++;

	if (!isEnabled) return;

	if (isConnected && rpcClient) {
		_setActivity(trackInfo);
	} else if (!rpcClient && !reconnectTimer) {
		initRPC();
	}
}

function clearPresence() {
	lastTrackInfo = null;
	trackRevision++;

	const client = rpcClient;

	if (!client || !isConnected) return;

	withTimeout(
		client.clearActivity(),
		ACTIVITY_TIMEOUT_MS,
		'Clear activity'
	).catch(err => {
		recoverConnection(client, err.message || String(err));
	});
}

function setEnabled(enabled) {
	isEnabled = !!enabled;

	if (isEnabled) {
		if (!rpcClient) {
			initRPC();
		} else if (lastTrackInfo) {
			_setActivity(lastTrackInfo);
		}
	} else {
		if (rpcClient && isConnected) {
			rpcClient.clearActivity().catch(() => { });
		}
		destroyRPC();
	}
}

function getEnabled() {
	return isEnabled;
}

function getConnected() {
	return isConnected;
}

function destroyRPC() {
	isDestroying = true;

	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}

	stopWatchdog();

	const client = rpcClient;

	rpcClient = null;
	isConnected = false;

	if (activityInFlightClient === client) {
		activityInFlightClient = null;
	}

	disposeClient(client);

	isDestroying = false;
}

module.exports = {
	initRPC,
	updatePresence,
	clearPresence,
	setEnabled,
	getEnabled,
	getConnected,
	destroyRPC,
};
