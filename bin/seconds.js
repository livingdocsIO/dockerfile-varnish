'use strict'
const regex = /(-?(?:\d+\.?\d*|\d*\.?\d+))\s*([^\s]*)/g
const formats = {}
formats.s = formats.second = formats.seconds = 1
formats.m = formats.minute = formats.minutes = formats.s * 60
formats.h = formats.hour = formats.hours = formats.m * 60
formats.d = formats.day = formats.days = formats.h * 24
formats.w = formats.week = formats.weeks = formats.d * 7

function toMs (str) {
  const nr = parseInt(str, 10)
  // eslint-disable-next-line eqeqeq
  if (nr == str) return nr
  if (!str) return null

  if (typeof str === 'number') {
    throw new Error(`Input to toMs should be a valid number`)
  } else if (typeof str !== 'string') {
    throw new Error(`Input to toMs should be a string`)
  }

  let result = null
  let check = str
  str.replace(regex, function (_, n, unit) {
    if (!unit) throw new Error(`Time unit missing in value: ${JSON.stringify(str)}`)
    const factor = formats[unit] || formats[unit.toLowerCase()]
    if (!factor) throw new Error(`Time unit not valid in value: ${JSON.stringify(str)}`)
    check = check.replace(n, '').replace(unit, '')
    result = (result || 0) + (parseFloat(n, 10) * factor)
  })

  if (!check.trim()) return result
  throw new Error(`Time value contains invalid characters: ${JSON.stringify(str)}`)
}

module.exports = toMs
