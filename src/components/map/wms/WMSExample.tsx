import React, { useEffect } from "react";
import { Map, View } from "ol";
import TileLayer from "ol/layer/Tile";
import TileWMS from "ol/source/TileWMS";
import ol_source_WTMS from "ol/source/WMTS";
import { fromLonLat } from "ol/proj";
import "ol/ol.css";
import { OSM } from "ol/source";

const WMSExample = () => {
  useEffect(() => {
    // Initialize the map
    const map = new Map({
      target: "map",
      layers: [
        // Base layer (optional)
        new TileLayer({
          source: new OSM(),
        }),
      ],
      view: new View({
        center: fromLonLat([15, 65]), // Center over Norway
        zoom: 4,
      }),
    });

    // Add the WMS layer
    const wmsLayer = new TileLayer({
      source: new TileWMS({
        url: "https://factmaps.sodir.no/arcgis/services/FactMaps/3_0/MapServer/WMSServer",
        params: {
          LAYERS: "7", // 'Orthophoto' layer
          FORMAT: "image/png",
          TRANSPARENT: true,
          VERSION: "1.3.0",
        },
        // serverType: "arcgis",
        crossOrigin: "anonymous",
      }),
    });

    map.addLayer(wmsLayer);

    // Optional: Adjust view to layer extent (hardcoded for Norway)
    map.getView().setCenter(fromLonLat([15, 65]));
    map.getView().setZoom(4);
  }, []);

  return <div id="map" style={{ width: "100%", height: "500px" }} />;
};

export default WMSExample;
