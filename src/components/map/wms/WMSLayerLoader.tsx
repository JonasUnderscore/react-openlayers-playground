import React, { useState, useEffect } from "react";
import ol_layer_Layer from "ol/layer/Layer";
import TileLayer from "ol/layer/Tile";
import TileWMS from "ol/source/TileWMS";
import MapContext from "../context/MapContext";
import * as ol_proj from "ol/proj";
import ol_source_WTMS from "ol/source/WMTS";
import ol_tilegrid_WMTS from "ol/tilegrid/WMTS";
import ol_source_Vector from "ol/source/Vector";
import ol_layer_Vector from "ol/layer/Vector";
import ol_format_GeoJSON from "ol/format/GeoJSON";
//import ol_format_GML from "ol/format/GML";

import * as ol_extent from 'ol/extent';

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

//#region util

const isArray: {
  <T, U>(v: T | readonly U[]): v is readonly U[];
  <T, U>(v: T | U[]): v is U[];
  (v: any): v is any[];
} = Array.isArray;

function uri_query_kvp(kvp: readonly (string | undefined | readonly (string | undefined)[])[] | null | undefined, _?: any): string[];
function uri_query_kvp(key: string | null | undefined, value: string | readonly string[] | null | undefined): string[];
function uri_query_kvp(key: readonly (string | undefined | readonly (string | undefined)[])[] | string | null | undefined, value: string | readonly (string | undefined)[] | null | undefined) {
  if (key == null) return [];
  let allowNoValue = true;
  if (isArray(key)) {
    value = key[1];
    key = key[0] as Exclude<typeof key, readonly unknown[]>;
    if (key == null) return [];
    allowNoValue = false;
  }
  let ks = encodeURIComponent(key);
  if (value == null) return allowNoValue ? [ks] : [];
  let r = [] as string[];
  if (isArray(value)) {
    for (let v of value) {
      if (v == null) continue;
      r.push(ks + "=" + encodeURIComponent(v));
    }
  }
  else {
    r.push(ks + "=" + encodeURIComponent(value));
  }
  return r;
}
function condArrVal<T>(v: readonly T[] | T | undefined): T | undefined {
  if (v === undefined) return undefined;
  if (isArray(v)) return v[0];
  return v;
}
function arrJoin(arr: string | readonly any[] | undefined, sep?: string): string {
  if (typeof arr === "string") return arr;
  if (arr === undefined) return "";
  return arr.join(sep);
}

function getElement(node: Node, name: string): Element | null {
  return Array.prototype.find.call(node.childNodes, (node) => (node as Partial<Element>).localName === name) as Element | undefined ?? null;
}
function getElements(node: Node, name: string): Element[] {
  return Array.prototype.filter.call(node.childNodes, (node) => (node as Partial<Element>).localName === name) as Element[];
}
function getElementText(node: Node, name: string): string | undefined {
  return getElement(node, name)?.textContent ?? undefined;
}

function projection_getName(projection: ol_proj.ProjectionLike): string | undefined {
  return typeof projection === "string" ? projection : projection?.getCode();
}

//#endregion

type ServiceInfoInit = {
  name: string;
  url: string;
  kind: ServiceKind;
  version?: string;
};
class ServiceInfo {
  name: string;
  url: string;
  kind: ServiceKind;
  version?: string;

  constructor(props: ServiceInfoInit) {
    this.name = props.name;
    this.url = props.url;
    this.kind = props.kind;
    this.version = props.version
  }
}

type LayerInfoInit = {
  id?: string;
  service?: ServiceInfo;
  name: string;
  title: string;
  parent?: LayerInfo;
};
class LayerInfo {
  service: ServiceInfo;
  id: string;
  name: string;
  title: string;
  parent?: LayerInfo;
  children: LayerInfo[];

  constructor(props: LayerInfoInit) {
    let parent = props.parent;
    let parentId = parent?.id;

    let name = props.name;
    let title = props.title;
    let service = props.service;

    let localId = (name || title || "unnamed");
    let id = props.id ?? (parentId ? `${parentId}/${localId}` : localId);

    this.service = service ?? parent!.service;
    this.name = name;
    this.title = title;
    this.id = id;
    this.parent = parent;
    this.children = [];
  }
}

function parseWMTSLayersFromCapabilities(xmlDoc: Document, url: string) {
  const capability = getElement(xmlDoc, "Capabilities");
  if (!capability) return undefined;

  let svcInfo = getElement(capability, "ServiceIdentification");
  let name: string | undefined;
  let version = capability.getAttribute("version") ?? undefined;
  if (svcInfo) {
    name = getElement(svcInfo, "Title")?.textContent ?? undefined;
  }
  let service = new ServiceInfo({ kind: "WMTS", url: url, name: name!, version: version });

  let contents = getElement(capability, "Contents");
  let root = new LayerInfo({ service: service, name: "", title: "all" });
  let layers: LayerInfo[] = [];
  if (contents) {
    parseWMTSLayerChildren(contents, root, service);
    layers.push(root);
  }
  return {
    layers: layers,
    service: service,
  };
}
function parseWMTSLayerChildren(node: ParentNode, parentLayer?: LayerInfo, service?: ServiceInfo) {
  let children = getElements(node, "Layer").map((childNode, index) => parseWMTSLayer(childNode, parentLayer, service));
  parentLayer?.children.push(...children);
  return children;
}
function parseWMTSLayer(layerNode: Element, parentLayer?: LayerInfo, service?: ServiceInfo): LayerInfo {
  let layer = new LayerInfo({
    service: service,
    name: getElementText(layerNode, "Identifier") ?? "",
    title: getElementText(layerNode, "Title") ?? "",
    parent: parentLayer,
  });
  parseWMTSLayerChildren(layerNode, layer);
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
function parseWMSLayersFromCapabilities(xmlDoc: Document, url: string): ParseLayersResult | undefined {
  const capability = xmlDoc.getElementsByTagName("Capability")[0];
  if (!capability) return undefined;

  let name = "";
  let version = getWMSVersion(xmlDoc);
  let service = new ServiceInfo({ kind: "WMS", url: url, name: name, version: version });

  let root = new LayerInfo({ service: service, name: "", title: "all" });
  let layers: LayerInfo[] = [];
  parseWMSLayerChildren(capability, root, service);
  layers.push(root);
  return {
    layers: layers,
    service: service,
  };
}
function parseWMSLayerChildren(node: ParentNode, parentLayer?: LayerInfo, service?: ServiceInfo) {
  let children = getElements(node, "Layer").map((childNode, index) => parseWMSLayer(childNode, parentLayer, service));
  parentLayer?.children.push(...children);
  return children;
}
function parseWMSLayer(layerNode: Element, parentLayer?: LayerInfo, service?: ServiceInfo): LayerInfo {
  let layer = new LayerInfo({
    service: service,
    name: getElementText(layerNode, "Name") ?? "",
    title: getElementText(layerNode, "Title") ?? "",
    parent: parentLayer,
  });
  parseWMSLayerChildren(layerNode, layer);
  return layer;
}

function parseWFSLayersFromCapabilities(xmlDoc: Document, url: string) {
  const capability = getElement(xmlDoc, "WFS_Capabilities"); // xmlDoc.getElementsByTagName("WFS_Capabilities")[0];
  if (!capability) return undefined;

  let name = "";
  let version = "2.0.0";
  let service = new ServiceInfo({ kind: "WFS", url: url, name: name, version: version });

  let root = new LayerInfo({ service: service, name: "", title: "all" });
  let layers: LayerInfo[] = [];
  let featureTypeList = getElement(capability, "FeatureTypeList");
  if (featureTypeList) {
    parseWFSLayerChildren(featureTypeList, root, service);
    layers.push(root);
  }
  return {
    layers: layers,
    service: service,
  };
}
function parseWFSLayerChildren(node: ParentNode, parentLayer?: LayerInfo, service?: ServiceInfo) {
  let children = getElements(node, "FeatureType").map((childNode, index) => parseWFSLayer(childNode, parentLayer, service));
  parentLayer?.children.push(...children);
  return children;
}
function parseWFSLayer(layerNode: Element, parentLayer?: LayerInfo, service?: ServiceInfo): LayerInfo {
  let layer = new LayerInfo({
    service: service,
    name: getElementText(layerNode, "Name") ?? "",
    title: getElementText(layerNode, "Title") ?? "",
    parent: parentLayer,
  });
  parseWFSLayerChildren(layerNode, layer);
  return layer;
}

const serviceKindArray = ["WMS", "WMTS", "WFS"] as const;

type ServiceKind = (typeof serviceKindArray)[number];

type ParseLayersResult = {
  layers: LayerInfo[];
  service?: ServiceInfo;
};

interface CapabilitiesUrlProps {
  service?: string;
  request?: string;
  version?: string | readonly string[];
  format?: string | readonly string[];
  updateSequence?: string | readonly string[];

  // WTMS specific
  sections?: string | readonly string[];
}
type ServiceKindInfo = {
  service: string;
  defaultVersion: string;
  parseLayersFromCapabilities: (this: ServiceKindInfo, xmlDoc: Document, url: string) => ParseLayersResult | undefined;
  capabilityQuery: (this: ServiceKindInfo, props: CapabilitiesUrlProps) => string | readonly string[] | undefined;
  createLayer: (this: ServiceKindInfo, l: LayerInfo, props: { projection: ol_proj.ProjectionLike }) => ol_layer_Layer;
  getVersion?: (this: ServiceKindInfo, xmlDoc: Document) => string;
};

const serviceKindMap = { __proto__: null as any,
  WMS: {
    service: "WMS",
    defaultVersion: "1.3.0",
    parseLayersFromCapabilities: parseWMSLayersFromCapabilities,
    getVersion: getWMSVersion,
    capabilityQuery(props: CapabilitiesUrlProps) {
      return [
        ["SERVICE", props.service ?? (this.service as string)],
        ["REQUEST", props.request ?? "GetCapabilities"],
        ["VERSION", condArrVal(props.version) ?? (this.defaultVersion as string)],
        ["FORMAT", condArrVal(props.format) ?? "application/xml"],
        ["UPDATESEQUENCE", condArrVal(props.updateSequence)],
      ].flatMap(uri_query_kvp);
    },
    createLayer(l, props) {
      const wmsLayer = new TileLayer({
        source: new TileWMS({
          url: l.service.url, // .split("?")[0],
          wrapX: true,
          params: {
            LAYERS: l.name,
            TILED: true,
            VERSION: l.service.version,
          },
          crossOrigin: "anonymous",
        }),
        opacity: 0.7,
        zIndex: 100,
      });
      return wmsLayer;
    },
  },
  WMTS: {
    service: "WMTS",
    defaultVersion: "1.0.0",
    getVersion: undefined,
    parseLayersFromCapabilities: parseWMTSLayersFromCapabilities,
    capabilityQuery(props: CapabilitiesUrlProps) {
      return [
        ["service", props.service ?? (this.service as string)],
        ["request", props.request ?? "GetCapabilities"],
        ["acceptVersions", props.version ?? (this.defaultVersion as string)],
        ["acceptFormats", props.format ?? "application/xml"],
        ["updateSequence", props.updateSequence],
      ].flatMap(uri_query_kvp);
    },
    createLayer(l, props) {
      const projection = ol_proj.get(props.projection)!;
      const projectionExtent = projection.getExtent();  // TODO: fix
      const size = ol_extent.getWidth(projectionExtent) / 256;
      const resolutions = new Array<number>(19);
      const matrixIds = new Array<string>(19);
      for (let z = 0; z < 19; ++z) {
        // generate resolutions and matrixIds arrays for this WMTS
        resolutions[z] = size / Math.pow(2, z);
        matrixIds[z] = "" + z;
      }
      return new TileLayer({
        source: new ol_source_WTMS({
          url: l.service.url,
          layer: l.name,
          matrixSet: "GoogleMapsCompatible", // TODO: fix
          format: "image/png",
          projection: props.projection, // TODO: check
          style: "default",
          wrapX: true,
          crossOrigin: "anonymous",
          tileGrid: new ol_tilegrid_WMTS({
            origin: ol_extent.getTopLeft(projectionExtent),
            resolutions: resolutions,
            matrixIds: matrixIds,
          }),
        }),
        opacity: 0.7,
        zIndex: 100,
      });
    }
  },
  WFS: {
    service: "WFS",
    defaultVersion: "2.0.0",
    parseLayersFromCapabilities: parseWFSLayersFromCapabilities,
    capabilityQuery(props: CapabilitiesUrlProps) {
      return [
        ["service", props.service ?? (this.service as string)],
        ["request", props.request ?? "GetCapabilities"],
        ["acceptversions", props.version ?? (this.defaultVersion as string)],
        ["outputFormat", condArrVal(props.format) ?? "application/json"],
      ].flatMap(uri_query_kvp);
    },
    createLayer(l, props) {
      let projName = projection_getName(props.projection) ?? "EPSG:3857";
      return new ol_layer_Vector({
        source: new ol_source_Vector({
          format: new ol_format_GeoJSON(), // TODO: fix
          url: function (extent) { // TODO: check if openlayers has an automatic way to do this
            if (!extent.some((v) => Number.isFinite(v))) {
              extent = ol_proj.get(props.projection)!.getExtent(); // TODO: fix, get from GetCapabilities
            }
            return (
              l.service.url + '?' + [
                ['service', 'WFS'],
                ['request', 'GetFeature'],
                ['typename', l.name],
                ['outputFormat', 'application/json'], // TODO: fix
                ['srsname', projName],
                ['bbox', extent.join(',') + ',' + projName],
              ].flatMap(uri_query_kvp).join('&')
            );
          },
        }),
        zIndex: 100,
      });
    },
  },
} satisfies Record<string, ServiceKindInfo & Record<string, unknown> | undefined>;

const WMSLayerLoader = () => {
  const { map } = React.useContext(MapContext);
  const [wmsUrl, setWmsUrl] = useState(defaultWMSURL);
  const [wmsVersion, setWmsVersion] = useState("1.3.0");
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [layerSelectionState, setLayerSelectionState] = useState<{
    [layerId: string]: SelectionState;
  }>({});

  const [serviceKind, setServiceKind] = useState<ServiceKind>("WMS");

  const fetchAndParseCapabilities = async () => {
    try {

      let fns = serviceKindMap[serviceKind]!;

      let u = wmsUrl;
      if (!u.includes("?")) {
        let q = arrJoin(fns.capabilityQuery({
          version: undefined,
          format: "application/xml",
        }), "&");
        if (q) u += "?" + q;
      }

      const response = await fetch(u);
      const text = await response.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, "text/xml");

      const parsedLayers = fns.parseLayersFromCapabilities(xmlDoc, wmsUrl.split("?")[0]);
      setLayers(parsedLayers?.layers ?? []);

      const version = parsedLayers?.service?.version ?? fns.defaultVersion;
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

    const selectedLayers = Object.entries(layerSelectionState)
      .map(([layerId, state]) => {
        if (state !== "selected") return undefined;
        const layer = findLayerById(layers, layerId);
        return layer;
      }).filter((l) => l != null);

    const mapLayers = map.getLayers().getArray();
    const existingLayerNames = mapLayers
      .filter((layer) => layer.get("wmsLayer") === true)
      .map((layer) => layer.get("name"));

    // Remove layers that are no longer selected
    existingLayerNames.forEach((name) => {
      if (!selectedLayers.some((l) => l.name === name)) {
        const layerToRemove = mapLayers.find((layer) => layer.get("name") === name);
        if (layerToRemove) {
          map.removeLayer(layerToRemove);
        }
      }
    });

    const projection = 'EPSG:3857';

    // Add new layers
    selectedLayers.forEach((l) => {
      if (!existingLayerNames.includes(l.name)) {
        let wmsLayer = serviceKindMap[l.service.kind]!.createLayer(l, { projection: projection });

        wmsLayer.set("name", l.name);
        wmsLayer.set("wmsLayer", true);
        map.addLayer(wmsLayer);
      }
    });

    // Adjust map view
    if (selectedLayers.length > 0) {
      let view = map.getView();
      view.setCenter(ol_proj.fromLonLat([15, 65], view.getProjection()));
      view.setZoom(4);
    }
  }, [layerSelectionState, map, wmsUrl, wmsVersion]);

  const findLayerById = (layers: LayerInfo[], id: string): LayerInfo | undefined => {
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
        onChange={(e) => setServiceKind(e.target.value as ServiceKind)}
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
