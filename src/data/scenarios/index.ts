import type { Scenario } from '../../engine/types'
import { shopfront } from './shopfront'
import { shortener } from './shortener'
import { clinicBooking } from './clinic'
import { notifyHub } from './notifications'
import { apiGuard } from './apiguard'
import { retailBff } from './bff'
import { observabilityRetrofit } from './observability'
import { learning } from './learning'
import { social } from './social'
import { delivery } from './delivery'
import { parcelLockers } from './lockers'
import { insurerStrangler } from './strangler'
import { tenantSaas } from './multitenant'
import { integrationsHub } from './integrations'
import { tickets } from './tickets'
import { neobank } from './neobank'
import { mobilePayScheme } from './mobilepay'
import { cellPlatform } from './cells'
import { exchangeEngine } from './exchange'
import { adClicks } from './adclicks'

export const SCENARIOS: Scenario[] = [
  // Beginner
  shopfront,
  shortener,
  clinicBooking,
  notifyHub,
  apiGuard,
  retailBff,
  // Intermediate
  observabilityRetrofit,
  learning,
  social,
  delivery,
  parcelLockers,
  insurerStrangler,
  tenantSaas,
  integrationsHub,
  // Advanced
  tickets,
  neobank,
  mobilePayScheme,
  cellPlatform,
  exchangeEngine,
  adClicks,
]

export const SCENARIO_BY_ID = Object.fromEntries(SCENARIOS.map((s) => [s.id, s])) as Record<string, Scenario>

export const INDUSTRIES = [...new Set(SCENARIOS.map((s) => s.industry))]
