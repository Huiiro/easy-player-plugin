export default {
    id: 'tremolo-dsp',
    name: 'Tremolo DSP',

    create(ctx) {
        const gain = ctx.createGain()
        gain.gain.value = 0.8

        const lfo = ctx.createOscillator()
        const lfoGain = ctx.createGain()
        lfo.frequency.value = 5
        lfoGain.gain.value = 0.5
        lfo.connect(lfoGain).connect(gain.gain)
        lfo.start()

        return {
            input: gain,
            output: gain,

            setParams(params) {
                if (params.rate !== undefined) lfo.frequency.value = params.rate
                if (params.depth !== undefined) lfoGain.gain.value = params.depth
            },

            destroy() {
                try {
                    gain.disconnect()
                    lfo.disconnect()
                    lfoGain.disconnect()
                    lfo.stop()
                    console.log('Tremolo DSP destroyed')
                } catch (e) {
                    console.warn('Error destroying tremolo DSP', e)
                }
            }
        }
    }
}