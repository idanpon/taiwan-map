CREATE TABLE place_ratings (
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK(typeof(rating) = 'integer' AND rating BETWEEN 1 AND 5),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (place_id, user_id)
);

CREATE VIEW place_rating_averages AS
  SELECT place_id, ROUND(AVG(rating), 1) AS average_rating
  FROM place_ratings
  GROUP BY place_id;
