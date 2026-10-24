/** Keep every native tag value in the library's existing text column. */
export function joinMetadataValues(values: string[] | undefined): string | undefined {
  const names = [...new Set(values?.map((value) => value.trim()).filter(Boolean))]
  return names.length ? names.join(', ') : undefined
}

/** Keep genre identity independent of tag spelling and the system locale. */
export function genreMatchKey(name: string): string {
  return name.trim().normalize('NFC').toLowerCase()
}
