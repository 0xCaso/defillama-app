import {
	YIELD_CONFIG_API,
	YIELD_POOLS_API,
	YIELD_MEDIAN_API,
	YIELD_URL_API,
	YIELD_CHAIN_API,
	YIELD_LEND_BORROW_API
} from '~/constants'
import { arrayFetcher } from '~/utils/useSWR'
import { formatYieldsPageData } from './utils'

export async function getYieldPageData() {
	let poolsAndConfig = await arrayFetcher([YIELD_POOLS_API, YIELD_CONFIG_API, YIELD_URL_API, YIELD_CHAIN_API])

	let data = formatYieldsPageData(poolsAndConfig)
	data.pools = data.pools.map((p) => ({
		...p,
		underlyingTokens: p.underlyingTokens ?? [],
		rewardTokens: p.rewardTokens ?? []
	}))

	const priceChainMapping = {
		binance: 'bsc',
		avalanche: 'avax',
		gnosis: 'xdai'
	}

	// get Price data
	let pricesList = []
	for (let p of data.pools) {
		if (p.rewardTokens) {
			let priceChainName = p.chain.toLowerCase()
			priceChainName = Object.keys(priceChainMapping).includes(priceChainName)
				? priceChainMapping[priceChainName]
				: priceChainName

			// using coingecko ids for projects on Neo, otherwise empty object
			pricesList.push(
				p.chain === 'Neo'
					? [`coingecko:${p.project}`]
					: p.rewardTokens.map((t) => `${priceChainName}:${t.toLowerCase()}`)
			)
		}
	}
	pricesList = [...new Set(pricesList.flat())]

	// price endpoint seems to break with too many tokens, splitting it to max 150 per request
	const maxSize = 150
	const pages = Math.ceil(pricesList.length / maxSize)
	let pricesA = []
	let x = ''
	for (const p of [...Array(pages).keys()]) {
		x = pricesList.slice(p * maxSize, maxSize * (p + 1)).join(',')
		pricesA = [...pricesA, (await arrayFetcher([`https://coins.llama.fi/prices/current/${x}`]))[0].coins]
	}
	// flatten
	let prices = {}
	for (const p of pricesA.flat()) {
		prices = { ...prices, ...p }
	}

	for (let p of data.pools) {
		let priceChainName = p.chain.toLowerCase()
		priceChainName = Object.keys(priceChainMapping).includes(priceChainName)
			? priceChainMapping[priceChainName]
			: priceChainName

		p['rewardTokensSymbols'] =
			p.chain === 'Neo'
				? [...new Set(p.rewardTokens.map((t) => prices[`coingecko:${p.project}`]?.symbol.toUpperCase() ?? null))]
				: [
						...new Set(
							p.rewardTokens.map((t) => prices[`${priceChainName}:${t.toLowerCase()}`]?.symbol.toUpperCase() ?? null)
						)
				  ]
	}

	for (let p of data.pools) {
		// need to map wrapped chain tokens
		// eg WAVAX -> AVAX
		// eg WFTM -> FTM
		const xy = p.rewardTokensSymbols.map((t) => {
			return t === 'WAVAX'
				? data.tokenNameMapping['AVAX']
				: t === 'WFTM'
				? data.tokenNameMapping['FTM']
				: data.tokenNameMapping[t]
		})
		p['rewardTokensNames'] = xy.filter((t) => t)
	}

	return {
		props: data
	}
}

export async function getYieldMedianData() {
	let data = (await arrayFetcher([YIELD_MEDIAN_API]))[0]
	// for the 4th of june we have low nb of datapoints which is skewing the median/
	// hence why we remove it from the plot
	data = data.filter((p) => p.timestamp !== '2022-06-04T00:00:00.000Z')

	// add 7day average field
	data = data
		.map((e) => ({ ...e, timestamp: e.timestamp.split('T')[0] }))
		.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
	// add rolling 7d avg of median values (first 6days == null)
	const windowSize = 7
	const apyMedianValues = data.map((m) => m.medianAPY)
	const avg = []
	for (let i = 0; i < apyMedianValues.length; i++) {
		if (i + 1 < windowSize) {
			avg[i] = null
		} else {
			avg[i] = apyMedianValues.slice(i + 1 - windowSize, i + 1).reduce((a, b) => a + b, 0) / windowSize
		}
	}
	data = data.map((m, i) => ({ ...m, avg7day: avg[i] }))

	return {
		props: data
	}
}

export async function getLendBorrowData() {
	const props = (await getYieldPageData()).props

	// filter to lending category only
	let pools = props.pools.filter((p) => p.category === 'Lending')

	// get new borrow fields
	let dataBorrow = (await arrayFetcher([YIELD_LEND_BORROW_API]))[0]

	// add borrow fields to pools (which contains all other columns we need for filters)
	pools = pools
		.map((p) => {
			const x = dataBorrow.find((i) => i.pool === p.pool)
			// for some projects we haven't added the new fields yet, dataBorrow will thus be smoler;
			// hence the check for undefined
			if (x === undefined) return null
			return {
				...p,
				apyBaseBorrow: -x.apyBaseBorrow,
				apyRewardBorrow: x.apyRewardBorrow,
				totalSupplyUsd: x.totalSupplyUsd,
				totalBorrowUsd: x.totalBorrowUsd,
				ltv: x.ltv,
				// note re morpho: they build on top of compound. if the total supply is being used by borrowers
				// then any excess borrows will be routed via compound pools. so the available liquidity is actually
				// compounds liquidity. not 100% sure how to present this on the frontend, but for now going to supress
				// liq values (cause some of them are negative)
				totalAvailableUsd: p.project === 'morpho' ? null : x.totalSupplyUsd - x.totalBorrowUsd,
				apyBorrow: -x.apyBaseBorrow + x.apyRewardBorrow,
				rewardTokens: p.apyRewards > 0 || x.apyRewardBorrow > 0 ? x.rewardTokens : p.rewardTokens
			}
		})
		.filter(Boolean)
		.sort((a, b) => b.totalSupplyUsd - a.totalSupplyUsd)

	return {
		props: {
			pools,
			chainList: [...new Set(pools.map((p) => p.chain))],
			projectList: props.projectList.filter((p) => [...new Set(pools.map((p) => p.project))].includes(p.slug)),
			categoryList: ['Lending'],
			tokenNameMapping: props.tokenNameMapping
		}
	}
}
