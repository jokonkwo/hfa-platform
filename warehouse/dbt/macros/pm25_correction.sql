{% macro purpleair_pm25_correction(pm25_col) %}
  -- PurpleAir PM2.5 correction (v1)
  --
  -- There are multiple correction formulas used in practice (EPA, LRAPA, AQ&U, etc.).
  -- For v1, we implement a simple, stable correction you can evolve later without
  -- breaking downstream tables: corrected = 0.52 * pm2.5 - 0.085 * humidity + 5.71
  --
  -- If humidity is unavailable, we fall back to a simple scaling.
  --
  -- NOTE: This macro expects that a column named `humidity` exists in scope.
  -- We keep it simple; later we can parameterize humidity col name too.

  case
    when {{ pm25_col }} is null then null
    when humidity is null then (0.8 * {{ pm25_col }})
    else (0.52 * {{ pm25_col }} - 0.085 * humidity + 5.71)
  end
{% endmacro %}
