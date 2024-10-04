'use client'

import { Provider } from 'react-redux'
/* Core */
// import { Provider } from 'react-redux'

/* Instruments */
import { reduxStore } from './redux'

export const Providers = (props: React.PropsWithChildren) => {
    return <Provider store={reduxStore}> {props.children} </Provider>

    // return <div>{ props } </div>
}