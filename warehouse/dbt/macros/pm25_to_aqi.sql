{% macro pm25_to_aqi(pm25_col) %}
  -- Convert PM2.5 (µg/m³) to US EPA AQI using breakpoints.
  -- Returns an integer AQI. If pm25 is null, returns null.

  case
    when {{ pm25_col }} is null then null

    -- 0.0 - 12.0 -> AQI 0 - 50
    when {{ pm25_col }} <= 12.0 then
      cast(round((50.0 / 12.0) * {{ pm25_col }}) as integer)

    -- 12.1 - 35.4 -> AQI 51 - 100
    when {{ pm25_col }} <= 35.4 then
      cast(round(((100.0 - 51.0) / (35.4 - 12.1)) * ({{ pm25_col }} - 12.1) + 51.0) as integer)

    -- 35.5 - 55.4 -> AQI 101 - 150
    when {{ pm25_col }} <= 55.4 then
      cast(round(((150.0 - 101.0) / (55.4 - 35.5)) * ({{ pm25_col }} - 35.5) + 101.0) as integer)

    -- 55.5 - 150.4 -> AQI 151 - 200
    when {{ pm25_col }} <= 150.4 then
      cast(round(((200.0 - 151.0) / (150.4 - 55.5)) * ({{ pm25_col }} - 55.5) + 151.0) as integer)

    -- 150.5 - 250.4 -> AQI 201 - 300
    when {{ pm25_col }} <= 250.4 then
      cast(round(((300.0 - 201.0) / (250.4 - 150.5)) * ({{ pm25_col }} - 150.5) + 201.0) as integer)

    -- 250.5 - 350.4 -> AQI 301 - 400
    when {{ pm25_col }} <= 350.4 then
      cast(round(((400.0 - 301.0) / (350.4 - 250.5)) * ({{ pm25_col }} - 250.5) + 301.0) as integer)

    -- 350.5 - 500.4 -> AQI 401 - 500
    when {{ pm25_col }} <= 500.4 then
      cast(round(((500.0 - 401.0) / (500.4 - 350.5)) * ({{ pm25_col }} - 350.5) + 401.0) as integer)

    else 500
  end
{% endmacro %}
