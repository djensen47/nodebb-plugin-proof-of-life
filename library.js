'use strict';

const COOKIE_NAME = 'nbb_human';
const COOKIE_VALUE = '1';
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const plugin = {};

function cookieOptions(req) {
	return {
		httpOnly: true,
		secure: !!(req && (req.secure || req.protocol === 'https')),
		sameSite: 'lax',
		maxAge: ONE_YEAR_MS,
		path: '/',
	};
}

function hasCookie(req) {
	return !!(req && req.cookies && req.cookies[COOKIE_NAME] === COOKIE_VALUE);
}

plugin.onLoggedIn = async function (data) {
	const req = data && data.req;
	const res = req && req.res;
	if (res && typeof res.cookie === 'function') {
		res.cookie(COOKIE_NAME, COOKIE_VALUE, cookieOptions(req));
	}
};

plugin.backfillCookie = async function (hookData) {
	const req = hookData && hookData.req;
	const res = hookData && hookData.res;
	if (req && res && typeof res.cookie === 'function' && req.uid > 0 && !hasCookie(req)) {
		res.cookie(COOKIE_NAME, COOKIE_VALUE, cookieOptions(req));
	}
	return hookData;
};

module.exports = plugin;
