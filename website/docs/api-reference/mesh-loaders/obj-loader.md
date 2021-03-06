# OBJLoader

This loader handles the OBJ half of the classic Wavefront OBJ/MTL format. The OBJ format is a simple ASCII format that lists vertices, normals and faces on successive lines.

| Loader                | Characteristic                                                          |
| --------------------- | ----------------------------------------------------------------------- |
| File Extension        | `.obj`                                                                  |
| File Type             | Text                                                                    |
| File Format           | [Wavefront OBJ file](https://en.wikipedia.org/wiki/Wavefront_.obj_file) |
| Data Format           | [Standardized Mesh](docs/api-reference/mesh-loaders/category-mesh.md)   |
| Encoder Type          | Synchronous                                                             |
| Worker Thread Support | Yes                                                                     |
| Streaming Support     | No                                                                      |

## Usage

```js
import {OBJLoader} from '@loaders.gl/obj';
import {load} from '@loaders.gl/core';

const data = await load(url, OBJLoader);
```

## Loader Options

N/A

## Data Loaded

- `positions` -
- `normals` -
- `faces` -

## Attribution/Credits

OBJLoader is a wrapper around the [`webgl-obj-loader`](https://www.npmjs.com/package/webgl-obj-loader) module.
