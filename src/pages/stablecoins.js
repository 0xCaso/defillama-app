import Layout from '~/layout'
import { maxAgeForNext } from '~/api'
import { getPeggedOverviewPageData } from '~/api/categories/stablecoins'
import { chainIconUrl } from '~/utils'
import { ChainStablecoins } from '~/containers/Chain/Stablecoins'

export async function getStaticProps() {
	const data = await getPeggedOverviewPageData(null)

	if (!data.filteredPeggedAssets || data.filteredPeggedAssets?.length === 0) {
		return {
			notFound: true
		}
	}

	const setSelectedChain = (newSelectedChain) => `/chain/${newSelectedChain}/stablecoins`

	let chainsList = ['All'].concat(data.chains).map((name) => ({
		name,
		label: name,
		to: setSelectedChain(name),
		route: setSelectedChain(name),
		logo: chainIconUrl(name)
	}))

	return {
		props: { ...data, chainsList },
		revalidate: maxAgeForNext([22])
	}
}

export default function PeggedAssets(props) {
	return (
		<Layout title={`Stablecoins Circulating - DefiLlama`} defaultSEO>
			<ChainStablecoins {...props} selectedChain="All" />
		</Layout>
	)
}
