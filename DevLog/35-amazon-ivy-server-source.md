# 35 AmazonIvyServer HTTPS Source

Date: 2026-04-30

## Context

The remote Amazon server is managed by `/home/russell/Documents/ali-server/game-logger.service`. The service file shows systemd starts `/usr/bin/node /opt/game-logger/game-logger-server.js` from `/opt/game-logger` with environment loaded from `/opt/game-logger/.env`.

That means the remote server is expected to expose the same Game Logger HTTP API shape as this project, including `/users`, `/session`, `/coffee`, and `/plant`.

## Changes

- Added `AmazonIvyServer` as a selectable browser data source.
- Added HTTPS-oriented placeholder text for AmazonIvyServer URLs.
- Defaulted bare AmazonIvyServer hostnames to `https://` in the browser URL normalizer.
- Updated the backend source parser to accept `amazonIvyServer`.
- Required AmazonIvyServer URLs to use `https://`.
- Internally mapped AmazonIvyServer to the existing Game Logger HTTP data path, so table browsing, remote sync, SQL over synced mirror tables, and AI analysis reuse the existing behavior.

## Verification Plan

- Use an HTTPS URL for the Amazon server in the Data Source URL field.
- Click `Sync Data Source`.
- Confirm synced mirror tables appear as `remote_users`, `remote_sessions`, `remote_coffee_sessions`, and `remote_plant_sessions`.
