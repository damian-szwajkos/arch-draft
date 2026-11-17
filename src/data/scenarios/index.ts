import type { Scenario } from '../../engine/types'
import { shopfront } from './shopfront'
import { shortener } from './shortener'
import { social } from './social'
import { delivery } from './delivery'
import { learning } from './learning'
import { observabilityRetrofit } from './observability'
import { tickets } from './tickets'
import { neobank } from './neobank'

export const SCENARIOS: Scenario[] = [shopfront, shortener, observabilityRetrofit, learning, social, delivery, tickets, neobank]

export const SCENARIO_BY_ID = Object.fromEntries(SCENARIOS.map((s) => [s.id, s])) as Record<string, Scenario>

export const INDUSTRIES = [...new Set(SCENARIOS.map((s) => s.industry))]
