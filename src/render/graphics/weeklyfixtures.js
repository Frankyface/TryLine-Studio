import { drawFixtureRows } from './weekly-shared.js'
export const meta = Object.freeze({ id: 'weeklyfixtures', label: 'Weekly fixtures', needs: 'week', description: 'Every upcoming game, paginated for legibility.' })
export const draw = (ctx, params) => drawFixtureRows(ctx, params, true)
