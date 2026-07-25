{% macro purpleair_pm25_correction(cf1_a, cf1_b, rh, temp_f) %}
  -- EPA/Barkjohn 2021 formula when temperature is available;
  -- falls back to the deployed non-EPA formula (same structure, empirical coefficients)
  -- for rows where temperature_f was not yet captured by the pipeline.
  case
    when {{ cf1_a }} is null or {{ cf1_b }} is null or {{ rh }} is null then null
    when {{ temp_f }} is not null
      then 0.541 * ({{ cf1_a }} + {{ cf1_b }}) / 2.0
           - 0.0618 * {{ rh }}
           + 0.00534 * {{ temp_f }}
           + 3.634
    else
      0.524 * ({{ cf1_a }} + {{ cf1_b }}) / 2.0
      - 0.0862 * {{ rh }}
      + 5.75
  end
{% endmacro %}
