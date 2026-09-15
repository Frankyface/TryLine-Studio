import { drawFixtureRows } from './weekly-shared.js'
export const meta = Object.freeze({ id: 'weeklyresults', label: 'Weekly results', needs: 'week', description: 'All the completed results in a league week.' })
export const draw = (ctx, params) => drawFixtureRows(ctx, params, false)
