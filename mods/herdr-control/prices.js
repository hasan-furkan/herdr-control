// API list prices, USD per million tokens. Estimates only.
// cache_read missing = 0.1 x input; cache_write = 1.25 x input. First entry whose 'match' is a substring of the
// model id (lowercased, dots replaced by dashes) wins; order matters (specific first).
export const PRICES = [
  {
    "match": "opus-5-5",
    "input": 4,
    "output": 20,
    "cache_read": 0.2
  },
  {
    "match": "opus-5",
    "input": 5,
    "output": 25,
    "cache_read": 0.5
  },
  {
    "match": "opus-4-8",
    "input": 5,
    "output": 25,
    "cache_read": 0.5
  },
  {
    "match": "opus-4-7",
    "input": 5,
    "output": 25,
    "cache_read": 0.5
  },
  {
    "match": "opus-4-6",
    "input": 5,
    "output": 25,
    "cache_read": 0.5
  },
  {
    "match": "sonnet-5-5",
    "input": 2,
    "output": 10,
    "cache_read": 0.1
  },
  {
    "match": "sonnet-5",
    "input": 2,
    "output": 10
  },
  {
    "match": "sonnet-4-6",
    "input": 3,
    "output": 15
  },
  {
    "match": "haiku-5-5",
    "input": 0.1,
    "output": 0.5
  },
  {
    "match": "haiku-4-5",
    "input": 1,
    "output": 5
  },
  {
    "match": "fable-5-2",
    "input": 8,
    "output": 40,
    "cache_read": 0.2
  },
  {
    "match": "fable-5-1",
    "input": 10,
    "output": 50
  },
  {
    "match": "fable-5",
    "input": 10,
    "output": 50
  },
  {
    "match": "deepseek-v4-1-flash",
    "input": 0.15,
    "output": 0.6,
    "cache_read": 0.003
  }
];
