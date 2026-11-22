/** LIKE wildcards in user input match literally. */
export const escapeLike = (term: string) => term.replaceAll(/[\\%_]/g, (char) => `\\${char}`);
