import React, { useState, useEffect } from "react";
import TileLayer from "ol/layer/Tile";
import TileWMS from "ol/source/TileWMS";
import MapContext from "../context/MapContext";
import { fromLonLat } from "ol/proj";
import ol_source_WTMS from "ol/source/WMTS";
import ol_tilegrid_WMTS from "ol/tilegrid/WMTS";

 
import {get as getProjection} from 'ol/proj.js';
import {getTopLeft, getWidth} from 'ol/extent.js';

type SelectionState = "selected" | "unselected" | "indeterminate";


const IndeterminateCheckbox = ({ id, checked, indeterminate, onChange, label }: CheckboxProps) => {
  const ref = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <>
      <input type="checkbox" id={id} checked={checked} ref={ref} onChange={onChange} />
      <label htmlFor={id}>{label}</label>
    </>
  );
};

interface CheckboxProps {
  id: string;
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  label: string;
}

type WMSLayer = {
  id: string; // Unique identifier
  name: string;
  title: string;
  children?: WMSLayer[];
  parent?: WMSLayer;
};

const defaultWMSURL = "https://factmaps.sodir.no/arcgis/services/FactMaps/3_0/MapServer/WMSServer?request=GetCapabilities&service=WMS";


function parseWMTSLayersFromCapabilities(xmlDoc: Document): WMSLayer[] {
  const capability = xmlDoc.getElementsByTagName("Capabilities")[0];
  if (!capability) return [];

  const topLayerNodes = Array.from(capability.getElementsByTagName("Contents")[0]!.childNodes).filter((node) => node.nodeName === "Layer") as Element[];

  return topLayerNodes.map((node, index) => parseWMTSLayer(node, undefined, `layer-${index}`));
}

function parseWMTSLayer(layerNode: Element, parentLayer?: WMSLayer, parentId: string = ""): WMSLayer {
  let childNodes = Array.from(layerNode.childNodes).filter((node) => node.nodeType === 1) as Element[];
  const identifierNode = childNodes.find((e) => e.localName.toLowerCase() === "identifier"); //layerNode.getElementsByTagName("Identifier")[0];
  const titleNode = childNodes.find((e) => e.localName.toLowerCase() === "title"); //layerNode.getElementsByTagName("Title")[0];

  const name = identifierNode?.textContent || "";
  const title = titleNode?.textContent || "";

  // Generate a unique ID by combining parent ID and current layer name or title
  const idPart =  name || title || "unnamed";
  const id = parentId ? `${parentId}/${idPart}` : idPart;

  const layer: WMSLayer = { id, name, title, parent: parentLayer };

  const childLayerNodes = childNodes.filter((node) => node.nodeName === "Layer") as Element[];

  if (childLayerNodes.length > 0) {
    layer.children = childLayerNodes.map((childNode, index) => parseWMTSLayer(childNode, layer, `${id}`));
  }

  return layer;
}

function getWMTSVersion(xmlDoc: Document): string {
  const wmtsCapability = xmlDoc.getElementsByTagName("Capabilities")[0];
  let version: string|null|undefined;
  if (wmtsCapability) {
    version = wmtsCapability.getAttribute("version");
  }
  return version || "1.0.0"; // Default version
}

function parseWMSLayersFromCapabilities(xmlDoc: Document): WMSLayer[] {
  const capability = xmlDoc.getElementsByTagName("Capability")[0];
  if (!capability) return [];

  const topLayerNodes = Array.from(capability.childNodes).filter((node) => node.nodeName === "Layer") as Element[];

  return topLayerNodes.map((node, index) => parseWMSLayer(node, undefined, `layer-${index}`));
}

function parseWMSLayer(layerNode: Element, parentLayer?: WMSLayer, parentId: string = ""): WMSLayer {
  const nameNode = layerNode.getElementsByTagName("Name")[0];
  const titleNode = layerNode.getElementsByTagName("Title")[0];

  const name = nameNode?.textContent || "";
  const title = titleNode?.textContent || "";

  // Generate a unique ID by combining parent ID and current layer name or title
  const idPart = name || title || "unnamed";
  const id = parentId ? `${parentId}/${idPart}` : idPart;

  const layer: WMSLayer = { id, name, title, parent: parentLayer };

  const childLayerNodes = Array.from(layerNode.childNodes).filter((node) => node.nodeName === "Layer") as Element[];

  if (childLayerNodes.length > 0) {
    layer.children = childLayerNodes.map((childNode, index) => parseWMSLayer(childNode, layer, `${id}`));
  }

  return layer;
}

const getWMSVersion = (xmlDoc: Document): string => {
  const wmsCapability = xmlDoc.getElementsByTagName("WMS_Capabilities")[0];
  if (wmsCapability) {
    return wmsCapability.getAttribute("version") || "1.3.0";
  }
  const wmtMsCapabilities = xmlDoc.getElementsByTagName("WMT_MS_Capabilities")[0];
  if (wmtMsCapabilities) {
    return wmtMsCapabilities.getAttribute("version") || "1.1.1";
  }
  return "1.3.0"; // Default version
};

const serviceKindArray = ["WMS", "WMTS"] as const;

type SeriviceKind = (typeof serviceKindArray)[number];

type ServiceKindInfo = {
  parseLayersFromCapabilities: (xmlDoc: Document) => WMSLayer[];
  getVersion: (xmlDoc: Document) => string;
};

const serviceKindMap = { __proto__: null as any,
  WMS: {
    parseLayersFromCapabilities: parseWMSLayersFromCapabilities,
    getVersion: getWMSVersion,
  },
  WMTS: {
    parseLayersFromCapabilities: parseWMTSLayersFromCapabilities,
    getVersion: getWMTSVersion,
  },
} as Record<string, ServiceKindInfo|undefined>;

const WMSLayerLoader = () => {
  const { map } = React.useContext(MapContext);
  const [wmsUrl, setWmsUrl] = useState(defaultWMSURL);
  const [wmsVersion, setWmsVersion] = useState("1.3.0");
  const [layers, setLayers] = useState<WMSLayer[]>([]);
  const [layerSelectionState, setLayerSelectionState] = useState<{
    [layerId: string]: SelectionState;
  }>({});

  const [serviceKind, setServiceKind] = useState<SeriviceKind>("WMS");

  const fetchAndParseCapabilities = async () => {
    try {
      const response = await fetch(wmsUrl);
      const text = await response.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, "text/xml");

      const parsedLayers = serviceKindMap[serviceKind]!.parseLayersFromCapabilities(xmlDoc);
      setLayers(parsedLayers);

      const version = serviceKindMap[serviceKind]!.getVersion(xmlDoc);
      setWmsVersion(version);
    } catch (error) {
      console.error("Error fetching or parsing GetCapabilities:", error);
    }
  };

  const handleLayerSelection = (layer: WMSLayer, newState?: SelectionState) => {
    const currentState = layerSelectionState[layer.id] || "unselected";
    const nextState = newState || (currentState === "selected" ? "unselected" : "selected");

    const updatedSelectionState = { ...layerSelectionState };
    updatedSelectionState[layer.id] = nextState;

    // Update children
    if (layer.children && layer.children.length > 0) {
      updateChildSelectionState(layer, nextState, updatedSelectionState);
    }

    // Update parents
    updateParentSelectionState(layer.parent, updatedSelectionState);

    setLayerSelectionState(updatedSelectionState);
  };

  const updateChildSelectionState = (
    layer: WMSLayer,
    state: SelectionState,
    selectionState: { [layerId: string]: SelectionState }
  ) => {
    if (layer.children) {
      layer.children.forEach((child) => {
        selectionState[child.id] = state;
        updateChildSelectionState(child, state, selectionState);
      });
    }
  };

  const updateParentSelectionState = (
    layer: WMSLayer | undefined,
    selectionState: { [layerId: string]: SelectionState }
  ) => {
    if (!layer) return;

    const childStates = layer.children?.map((child) => selectionState[child.id]) || [];

    let newState: SelectionState;
    if (childStates.every((state) => state === "selected")) {
      newState = "selected";
    } else if (childStates.every((state) => state === "unselected")) {
      newState = "unselected";
    } else {
      newState = "indeterminate";
    }

    selectionState[layer.id] = newState;

    updateParentSelectionState(layer.parent, selectionState);
  };

  const renderLayerTree = (layers: WMSLayer[], level = 0) => {
    return layers.map((layer) => {
      const hasChildren = layer.children && layer.children.length > 0;
      const paddingLeft = level * 20;
      const selectionState = layerSelectionState[layer.id] || "unselected";

      const isChecked = selectionState === "selected";
      const isIndeterminate = selectionState === "indeterminate";

      return (
        <div key={layer.id}>
          <div style={{ paddingLeft: `${paddingLeft}px` }}>
            {layer.name && (
              <IndeterminateCheckbox
                id={layer.id}
                checked={isChecked}
                indeterminate={isIndeterminate}
                onChange={() => handleLayerSelection(layer)}
                label={layer.title}
              />
            )}
            {!layer.name && (
              <span>
                <strong>{layer.title}</strong>
              </span>
            )}
          </div>
          {hasChildren && renderLayerTree(layer.children!, level + 1)}
        </div>
      );
    });
  };

  useEffect(() => {
    if (!map) return;

    const selectedLayerNames = Object.entries(layerSelectionState)
      .filter(([_, state]) => state === "selected")
      .map(([layerId]) => {
        // Find the layer by ID to get its name
        const layer = findLayerById(layers, layerId);
        return layer?.name;
      })
      .filter((name): name is string => !!name); // Filter out undefined names

    const mapLayers = map.getLayers().getArray();
    const existingLayerNames = mapLayers
      .filter((layer) => layer.get("wmsLayer") === true)
      .map((layer) => layer.get("name"));

    // Remove layers that are no longer selected
    existingLayerNames.forEach((name) => {
      if (!selectedLayerNames.includes(name)) {
        const layerToRemove = mapLayers.find((layer) => layer.get("name") === name);
        if (layerToRemove) {
          map.removeLayer(layerToRemove);
        }
      }
    });

    const projection = getProjection('EPSG:3857')!;
  const projectionExtent = projection.getExtent();
  const size = getWidth(projectionExtent) / 256;
  const resolutions = new Array<number>(19);
  const matrixIds = new Array<string>(19);
  for (let z = 0; z < 19; ++z) {
    // generate resolutions and matrixIds arrays for this WMTS
    resolutions[z] = size / Math.pow(2, z);
    matrixIds[z] = ""+z;
  }

    // Add new layers
    selectedLayerNames.forEach((layerName) => {
      if (!existingLayerNames.includes(layerName)) {
        const wmsLayer = new TileLayer({
          //source: new TileWMS({
          source: new ol_source_WTMS({
            url: wmsUrl.split("?")[0],
            layer: layerName,
            matrixSet: "GoogleMapsCompatible",
            format: "image/png",
            projection: "EPSG:25833",
            style: "default",
            wrapX: true,
            /* params: {
              LAYERS: layerName,
              TILED: true,
              VERSION: wmsVersion,
            }, */
            crossOrigin: "anonymous",
            tileGrid: new ol_tilegrid_WMTS({
              origin: getTopLeft(projectionExtent),
              resolutions: resolutions,
              matrixIds: matrixIds,
            }),
          }),
          opacity: 0.7,
          zIndex: 100,
        });
        wmsLayer.set("name", layerName);
        wmsLayer.set("wmsLayer", true);
        map.addLayer(wmsLayer);
      }
    });

    // Adjust map view
    if (selectedLayerNames.length > 0) {
      map.getView().setCenter(fromLonLat([15, 65]));
      map.getView().setZoom(4);
    }
  }, [layerSelectionState, map, wmsUrl, wmsVersion]);

  const findLayerById = (layers: WMSLayer[], id: string): WMSLayer | undefined => {
    for (const layer of layers) {
      if (layer.id === id) return layer;
      if (layer.children) {
        const childLayer = findLayerById(layer.children, id);
        if (childLayer) return childLayer;
      }
    }
    return undefined;
  };

  return (
    <div>
      <input
        type="text"
        value={wmsUrl}
        onChange={(e) => setWmsUrl(e.target.value)}
        placeholder="Enter WMS GetCapabilities URL"
        size={100}
      />
      <select
        value={serviceKind}
        onChange={(e) => setServiceKind(e.target.value as SeriviceKind)}
        title="Select the service kind"
      >
        {serviceKindArray.map((kind, index) => (
          <option key={index} value={kind}>
            {kind}
          </option>
        ))}
      </select>
      <button onClick={fetchAndParseCapabilities}>Load Layers</button>

      {layers.length > 0 && (
        <div>
          <h3>Select Layers to Add:</h3>
          {renderLayerTree(layers)}
        </div>
      )}
    </div>
  );
};

export default WMSLayerLoader;
