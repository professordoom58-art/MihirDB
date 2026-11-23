import type { Movie } from '../types'
import { posterSrc } from '../lib/tmdb'

/**
 * Optional sample shelf (Settings → "Load sample movies"). Ratings are placeholders.
 * Critic scores are left empty and filled from OMDb in the background.
 */
type Seed = [
  tmdbId: number,
  imdbId: string,
  title: string,
  year: number,
  director: string,
  runtime: number,
  genres: string[],
  posterPath: string,
  myRating: number,
]

const seeds: Seed[] = [
  [278, 'tt0111161', 'The Shawshank Redemption', 1994, 'Frank Darabont', 142, ['Drama', 'Crime'], '/q6y0Go1tsGEsmtFryDOJo3dEmqu.jpg', 10],
  [238, 'tt0068646', 'The Godfather', 1972, 'Francis Ford Coppola', 175, ['Drama', 'Crime'], '/3bhkrj58Vtu7enYsRolD1fZdja1.jpg', 9.5],
  [155, 'tt0468569', 'The Dark Knight', 2008, 'Christopher Nolan', 152, ['Action', 'Crime', 'Drama'], '/qJ2tW6WMUDux911r6m7haRef0WH.jpg', 9.5],
  [27205, 'tt1375666', 'Inception', 2010, 'Christopher Nolan', 148, ['Action', 'Science Fiction', 'Adventure'], '/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg', 9],
  [157336, 'tt0816692', 'Interstellar', 2014, 'Christopher Nolan', 169, ['Adventure', 'Drama', 'Science Fiction'], '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg', 9.5],
  [680, 'tt0110912', 'Pulp Fiction', 1994, 'Quentin Tarantino', 154, ['Thriller', 'Crime'], '/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg', 9],
  [496243, 'tt6751668', 'Parasite', 2019, 'Bong Joon Ho', 133, ['Comedy', 'Thriller', 'Drama'], '/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg', 9],
  [129, 'tt0245429', 'Spirited Away', 2001, 'Hayao Miyazaki', 125, ['Animation', 'Family', 'Fantasy'], '/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg', 8.5],
  [244786, 'tt2582802', 'Whiplash', 2014, 'Damien Chazelle', 107, ['Drama', 'Music'], '/7fn624j5lj3xTme2SgiLCeuedmO.jpg', 8.5],
  [313369, 'tt3783958', 'La La Land', 2016, 'Damien Chazelle', 129, ['Comedy', 'Drama', 'Romance'], '/uDO8zWDhfWwoFdKS4fzkUJt0Rf0.jpg', 8],
  [603, 'tt0133093', 'The Matrix', 1999, 'Lana & Lilly Wachowski', 136, ['Action', 'Science Fiction'], '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg', 8.5],
  [335984, 'tt1856101', 'Blade Runner 2049', 2017, 'Denis Villeneuve', 164, ['Science Fiction', 'Drama'], '/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg', 9],
  [76341, 'tt1392190', 'Mad Max: Fury Road', 2015, 'George Miller', 121, ['Action', 'Adventure', 'Science Fiction'], '/hA2ple9q4qnwxp3hKVNhroipsir.jpg', 8],
  [438631, 'tt1160419', 'Dune', 2021, 'Denis Villeneuve', 155, ['Science Fiction', 'Adventure'], '/d5NXSklXo0qyIYkgV94XAgMIckC.jpg', 7.5],
  [329865, 'tt2543164', 'Arrival', 2016, 'Denis Villeneuve', 116, ['Drama', 'Science Fiction', 'Mystery'], '/x2FJsf1ElAgr63Y3PNPtJrcmpoe.jpg', 8.5],
]

export function sampleMovies(): Movie[] {
  const base = Date.now() - seeds.length * 60_000
  return seeds.map(([tmdbId, imdbId, title, year, director, runtime, genres, posterPath, myRating], i) => ({
    id: `sample-${tmdbId}`,
    tmdbId,
    imdbId,
    title,
    year,
    director,
    runtime,
    genres,
    posterPath,
    posterUrl: posterSrc(posterPath, 'w780'),
    myRating,
    myReview: 'Sample entry. Edit or delete me.',
    scoresStatus: 'pending' as const,
    // staggered so rating ties have a deterministic "most recently added" order
    addedAt: base + i * 60_000,
    updatedAt: base + i * 60_000,
  }))
}
